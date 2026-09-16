/**
 * 브라우저와 서버가 같은 이벤트 체계를 함께 쓸 때의 설계를 측정한다.
 *
 * 1. 게이트웨이가 거르는 것
 * 2. 기다리지 않고 응답할 때의 대가
 * 3. 파티션 시간대가 어긋날 때
 * 4. 버퍼가 여러 겹일 때의 지연
 */
import { randomUUID } from 'node:crypto'
import { Stream } from '../src/stream.js'
import { Gateway } from '../src/gateway.js'
import { AnalyticsClient, createServerProducer } from '../src/client.js'
import { partitionAll, readKstDay } from '../src/partition.js'
import type { AnalyticsEvent } from '../src/event.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : undefined
const runs = (n: number) => ONLY === undefined || ONLY === n
const results: Record<string, unknown>[] = []

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

async function main() {
  // 1. 게이트웨이가 거르는 것
  if (runs(1)) {
    const stream = new Stream()
    const gw = new Gateway(stream, { fireAndForget: false, rateLimitPerDevice: 5 })

    const bot = await gw.ingest([event()], { ...BROWSER, userAgent: 'Googlebot/2.1' })
    const foreign = await gw.ingest([event()], { ...BROWSER, origin: 'https://evil.test' })
    const bad = await gw.ingest([
      event({ insertId: 'not-a-uuid' }),
      event({ eventType: '' }),
      event({ occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
      event(),
    ], BROWSER)
    const flood = await gw.ingest(Array.from({ length: 10 }, () => event()), BROWSER)

    results.push({
      시나리오: '1. 게이트웨이가 거르는 것',
      '봇 UA': bot.rejected[0]?.reason,
      '외부 Origin': foreign.rejected[0]?.reason,
      '잘못된 이벤트': `${bad.rejected.length}건 거절, ${bad.accepted}건 통과`,
      '한도 초과': `${flood.rejected.length}건 거절, ${flood.accepted}건 통과`,
      '스트림 도달': stream.size,
    })
  }

  // 2. 기다리지 않고 응답할 때의 대가
  if (runs(2)) {
    for (const fireAndForget of [true, false]) {
      // 스트림이 잠깐 죽었다가 살아난다. 재시도가 살릴 수 있는 상황이다.
      const stream = new Stream()
      const gw = new Gateway(stream, { fireAndForget })
      const client = new AnalyticsClient({
        sourceApp: 'web', maxBatchSize: 5, flushIntervalMs: 60_000, maxRetries: 3,
        send: (events) => gw.ingest(events, BROWSER),
      })

      stream.setMode('down')
      setTimeout(() => stream.setMode('ok'), 60)

      for (let i = 0; i < 5; i += 1) client.track('click', { i })
      await client.flush()
      await gw.drain()

      results.push({
        시나리오: '2. 스트림이 잠깐 죽었다 살아날 때',
        방식: fireAndForget ? '기다리지 않음' : '기다림',
        '클라이언트가 본 결과': client.stats.dropped === 0 ? '성공' : '실패',
        '클라이언트 전송 시도': client.stats.attempts,
        '실제 적재': stream.size,
        유실: 5 - stream.size,
      })
    }

    // 계속 죽어 있으면 어떻게 되는가
    for (const fireAndForget of [true, false]) {
      const stream = new Stream()
      const gw = new Gateway(stream, { fireAndForget })
      const client = new AnalyticsClient({
        sourceApp: 'web', maxBatchSize: 5, flushIntervalMs: 60_000, maxRetries: 3,
        send: (events) => gw.ingest(events, BROWSER),
      })

      stream.setMode('down')
      for (let i = 0; i < 5; i += 1) client.track('click', { i })
      await client.flush()
      await gw.drain()

      results.push({
        시나리오: '2-2. 스트림이 계속 죽어 있을 때',
        방식: fireAndForget ? '기다리지 않음' : '기다림',
        '클라이언트가 본 결과': client.stats.dropped === 0 ? '성공' : '실패',
        '클라이언트 전송 시도': client.stats.attempts,
        '실제 적재': stream.size,
        유실: 5 - stream.size,
      })
    }
  }

  // 3. 파티션 시간대가 어긋날 때
  if (runs(3)) {
    const stream = new Stream()
    // KST 기준 2026-03-02 하루치. 00:30과 23:30이 UTC로는 다른 날이 된다.
    const kstTimes = ['00:30', '09:00', '15:00', '23:30']
    const events = kstTimes.map((t) => {
      const [h, m] = t.split(':').map(Number)
      const utc = new Date(Date.UTC(2026, 2, 2, h - 9, m))
      return event({ receivedAt: utc.toISOString() })
    })
    await stream.put(events)

    const utcParts = partitionAll(stream.all, 'utc')
    const kstParts = partitionAll(stream.all, 'kst')

    results.push({
      시나리오: '3. 파티션 시간대',
      'UTC 파티션': [...utcParts].map(([k, v]) => `${k}:${v.length}`).join(' '),
      'KST 파티션': [...kstParts].map(([k, v]) => `${k}:${v.length}`).join(' '),
      'UTC에서 하루만 읽기': readKstDay(utcParts, '2026-03-02', { widen: false }).length,
      'UTC에서 넓게 읽기': readKstDay(utcParts, '2026-03-02', { widen: true }).length,
      '실제 그날 건수': 4,
    })
  }

  // 4. 버퍼가 여러 겹일 때의 지연
  if (runs(4)) {
    const stream = new Stream()
    const gw = new Gateway(stream, { fireAndForget: false })
    const CLIENT_FLUSH = 300
    const DELIVERY_BUFFER = 500

    const client = new AnalyticsClient({
      sourceApp: 'web', maxBatchSize: 1000, flushIntervalMs: CLIENT_FLUSH,
      send: (events) => gw.ingest(events, BROWSER),
    })

    const started = Date.now()
    client.track('view_item')
    await new Promise((r) => setTimeout(r, CLIENT_FLUSH + 60))
    await gw.drain()
    const atStream = Date.now() - started

    // 전송 서비스가 스트림에서 꺼내 저장소로 내리는 주기
    await new Promise((r) => setTimeout(r, DELIVERY_BUFFER))
    const atStorage = Date.now() - started

    const server = createServerProducer('api', (e) => stream.put(e))
    const t2 = Date.now()
    await server('purchase')
    const serverToStream = Date.now() - t2

    results.push({
      시나리오: '4. 끝에서 끝까지 지연',
      '브라우저 → 스트림(ms)': atStream,
      '브라우저 → 저장소(ms)': atStorage,
      '서버 → 스트림(ms)': serverToStream,
      '버퍼 층수': '클라 1 + 게이트웨이 1 + 전송 1',
    })
  }

  for (const r of results) {
    const { 시나리오, ...rest } = r as any
    console.log(`\n## ${시나리오}`)
    console.table([rest])
  }
}

main()
