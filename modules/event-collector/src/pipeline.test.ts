import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { EventBuffer } from './buffer.js'
import { createCollector } from './collector.js'
import { createS3, ensureBucket, createS3Sink, listKeys, readEvents, BUCKET } from './sink.js'
import { openWarehouse, loadEvents, countEvents } from './warehouse.js'
import type { RawEvent, StoredEvent } from './event.js'

const s3 = createS3()

function event(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    eventId: randomUUID(),
    name: 'item_viewed',
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
    payload: { itemId: 42 },
    ...overrides,
  }
}

beforeAll(async () => {
  await ensureBucket(s3)
}, 30_000)

describe('수집', () => {
  it('잘못된 이벤트가 섞여도 나머지는 수집한다', () => {
    const buffer = new EventBuffer(async () => {})
    const collect = createCollector(buffer)

    const result = collect([
      event(),
      event({ eventId: '' }),
      event({ name: '' }),
      event(),
    ])

    expect(result.accepted).toBe(2)
    expect(result.rejected).toHaveLength(2)
    expect(result.rejected[0].reason).toBe('eventId 없음')
  })

  it('클라이언트 시각이 아니라 서버 시각을 붙인다', () => {
    const batches: StoredEvent[][] = []
    const buffer = new EventBuffer(async (b) => void batches.push(b), { maxEvents: 1 })
    createCollector(buffer)([event({ occurredAt: '1999-01-01T00:00:00.000Z' })])

    const stored = batches[0][0]
    expect(stored.occurredAt).toBe('1999-01-01T00:00:00.000Z')
    expect(new Date(stored.receivedAt).getFullYear()).toBeGreaterThan(2020)
  })
})

describe('버퍼', () => {
  it('크기 조건으로 내보낸다', async () => {
    const batches: StoredEvent[][] = []
    const buffer = new EventBuffer(async (b) => void batches.push(b), {
      maxEvents: 3,
      maxAgeMs: 60_000,
    })
    const collect = createCollector(buffer)

    collect([event(), event()])
    expect(batches).toHaveLength(0)

    collect([event()])
    await new Promise((r) => setTimeout(r, 10))
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(3)
  })

  it('시간 조건으로 내보낸다', async () => {
    const batches: StoredEvent[][] = []
    const buffer = new EventBuffer(async (b) => void batches.push(b), {
      maxEvents: 1000,
      maxAgeMs: 30,
    })
    createCollector(buffer)([event()])

    expect(batches).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 60))
    expect(batches).toHaveLength(1)
  })
})

describe('적재', () => {
  it('같은 파일을 두 번 적재해도 행 수가 같다', async () => {
    const buffer = new EventBuffer(createS3Sink(s3), { maxEvents: 5 })
    const collect = createCollector(buffer)
    collect(Array.from({ length: 5 }, () => event()))
    await buffer.flush()

    const keys = await listKeys(s3)
    const events = await readEvents(s3, keys[keys.length - 1])

    const conn = await openWarehouse()
    await loadEvents(conn, events)
    const first = await countEvents(conn)

    await loadEvents(conn, events)
    const second = await countEvents(conn)

    expect(first).toBe(5)
    expect(second).toBe(first)
  }, 30_000)
})

describe('적재 건수', () => {
  it('중복을 건너뛴 만큼 빼고 센다', async () => {
    // 버킷이 테스트 사이에 남는다. 이번에 새로 생긴 키만 읽는다.
    const before = new Set(await listKeys(s3))

    const buffer = new EventBuffer(createS3Sink(s3), { maxEvents: 3 })
    createCollector(buffer)(Array.from({ length: 3 }, () => event()))
    await buffer.flush()

    const fresh = (await listKeys(s3)).filter((k) => !before.has(k))
    expect(fresh).toHaveLength(1)
    const events = await readEvents(s3, fresh[0])

    const conn = await openWarehouse()
    expect((await loadEvents(conn, events)).inserted).toBe(3)
    expect((await loadEvents(conn, events)).inserted).toBe(0)
  }, 30_000)
})
