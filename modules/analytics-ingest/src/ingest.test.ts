import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Stream } from './stream.js'
import { Gateway } from './gateway.js'
import { AnalyticsClient, createServerProducer } from './client.js'
import { partitionAll, partitionKey, readKstDay } from './partition.js'
import type { AnalyticsEvent } from './event.js'

const BROWSER = {
  deviceId: 'device-1',
  userAgent: 'Mozilla/5.0 Chrome/120',
  origin: 'https://example.com',
}

function event(over: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    insertId: randomUUID(),
    eventType: 'page_view',
    sourceApp: 'web',
    producerType: 'client',
    occurredAt: new Date().toISOString(),
    schemaVersion: 2,
    payload: {},
    ...over,
  }
}

describe('게이트웨이', () => {
  it('봇과 외부 Origin은 받지 않는다', async () => {
    const gw = new Gateway(new Stream(), { fireAndForget: false })

    const bot = await gw.ingest([event()], { ...BROWSER, userAgent: 'Googlebot/2.1' })
    expect(bot.accepted).toBe(0)

    const foreign = await gw.ingest([event()], { ...BROWSER, origin: 'https://evil.test' })
    expect(foreign.accepted).toBe(0)
  })

  it('잘못된 건만 버리고 나머지는 받는다', async () => {
    const stream = new Stream()
    const gw = new Gateway(stream, { fireAndForget: false })

    const r = await gw.ingest([
      event({ insertId: 'not-a-uuid' }),
      event(),
      event({ eventType: '' }),
      event(),
    ], BROWSER)

    expect(r.accepted).toBe(2)
    expect(r.rejected).toHaveLength(2)
    expect(stream.size).toBe(2)
  })

  it('프로듀서가 보낸 수신 시각을 덮어쓴다', async () => {
    const stream = new Stream()
    const gw = new Gateway(stream, { fireAndForget: false })

    await gw.ingest([event({ receivedAt: '1999-01-01T00:00:00.000Z' })], BROWSER)

    const stored = stream.all[0]
    expect(new Date(stored.receivedAt!).getFullYear()).toBeGreaterThan(2020)
  })

  it('미래로 크게 벗어난 시각은 받지 않는다', async () => {
    const gw = new Gateway(new Stream(), { fireAndForget: false })
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const r = await gw.ingest([event({ occurredAt: future })], BROWSER)
    expect(r.rejected[0].reason).toContain('미래')
  })
})

describe('기다리지 않고 응답할 때', () => {
  it('스트림이 죽어도 클라이언트는 성공으로 안다', async () => {
    const stream = new Stream()
    stream.setMode('down')
    const gw = new Gateway(stream, { fireAndForget: true })
    const client = new AnalyticsClient({
      sourceApp: 'web', maxBatchSize: 2, flushIntervalMs: 60_000, maxRetries: 3,
      send: (e) => gw.ingest(e, BROWSER),
    })

    client.track('a')
    client.track('b')
    await client.flush()
    await gw.drain()

    expect(client.stats.dropped).toBe(0)
    expect(stream.size).toBe(0)
  })

  it('기다리면 잠깐 죽은 구간을 재시도가 살린다', async () => {
    const stream = new Stream()
    stream.setMode('down')
    setTimeout(() => stream.setMode('ok'), 60)

    const gw = new Gateway(stream, { fireAndForget: false })
    const client = new AnalyticsClient({
      sourceApp: 'web', maxBatchSize: 2, flushIntervalMs: 60_000, maxRetries: 3,
      send: (e) => gw.ingest(e, BROWSER),
    })

    client.track('a')
    client.track('b')
    await client.flush()

    expect(stream.size).toBe(2)
    expect(client.stats.attempts).toBeGreaterThan(1)
  })
})

describe('서버 프로듀서', () => {
  it('게이트웨이를 거치지 않고 스트림에 쓴다', async () => {
    const stream = new Stream()
    const emit = createServerProducer('api', (e) => stream.put(e))

    await emit('purchase', { orderId: 1 })

    expect(stream.size).toBe(1)
    expect(stream.all[0].producerType).toBe('server')
    expect(stream.all[0].receivedAt).toBeDefined()
  })
})

describe('파티션 시간대', () => {
  it('KST 자정 직후는 UTC로 전날이 된다', () => {
    const kstMidnight30 = new Date(Date.UTC(2026, 2, 1, 15, 30)).toISOString()
    expect(partitionKey(kstMidnight30, 'utc')).toBe('2026-03-01')
    expect(partitionKey(kstMidnight30, 'kst')).toBe('2026-03-02')
  })

  it('UTC 파티션에서 하루만 읽으면 일부가 빠진다', async () => {
    const stream = new Stream()
    const times = ['00:30', '09:00', '15:00', '23:30']
    await stream.put(times.map((t) => {
      const [h, m] = t.split(':').map(Number)
      return event({ receivedAt: new Date(Date.UTC(2026, 2, 2, h - 9, m)).toISOString() })
    }))

    const parts = partitionAll(stream.all, 'utc')
    expect(readKstDay(parts, '2026-03-02', { widen: false })).toHaveLength(3)
    expect(readKstDay(parts, '2026-03-02', { widen: true })).toHaveLength(4)
  })

  it('KST로 나누면 하루가 한 파티션에 들어간다', async () => {
    const stream = new Stream()
    const times = ['00:30', '23:30']
    await stream.put(times.map((t) => {
      const [h, m] = t.split(':').map(Number)
      return event({ receivedAt: new Date(Date.UTC(2026, 2, 2, h - 9, m)).toISOString() })
    }))

    const parts = partitionAll(stream.all, 'kst')
    expect(parts.size).toBe(1)
    expect(parts.get('2026-03-02')).toHaveLength(2)
  })
})
