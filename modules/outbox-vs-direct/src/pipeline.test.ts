import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Queue } from 'bullmq'
import type { Worker } from 'bullmq'
import { createPool } from './db.js'
import { startReceiver, type Receiver } from './receiver.js'
import { placeOrderDirect } from './direct.js'
import { createQueue, placeOrderOutbox } from './outbox.js'
import { startWorker } from './worker.js'
import { sweepOnce } from './sweeper.js'
import { setReceiverPort } from './endpoint.js'

const pool = createPool()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const RUN = Date.now()

let receiver: Receiver
let queue: Queue
let worker: Worker
let seq = 0

beforeAll(async () => {
  setReceiverPort(4802)
  receiver = await startReceiver(4802)
}, 30_000)

beforeEach(async () => {
  const sql = readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf8')
  for (const s of sql.split(';').map((x) => x.trim()).filter(Boolean)) await pool.query(s)

  // 스키마를 다시 만들면 아웃박스 PK가 1부터라 jobId가 겹친다.
  // 테스트마다 큐 이름을 바꾼다.
  seq += 1
  const name = `test-${RUN}-${seq}`
  queue = createQueue(name)
  worker = startWorker(pool, name)
  receiver.received.length = 0
  receiver.setMode('ok')
})

afterAll(async () => {
  await worker?.close()
  await queue?.close()
  await receiver?.close()
  await pool.end()
})

describe('트랜잭션 롤백', () => {
  it('직접 호출은 없던 주문의 통보를 내보낸다', async () => {
    const r = await placeOrderDirect(pool, 10000, { failAfterSend: true })
    expect(r.committed).toBe(false)
    expect(receiver.received.some((x) => x.orderId === r.orderId)).toBe(true)
  })

  it('아웃박스는 주문과 이벤트가 같이 사라진다', async () => {
    const r = await placeOrderOutbox(pool, queue, 10000, { failAfterWrite: true })
    await wait(300)
    expect(r.committed).toBe(false)
    expect(receiver.received).toHaveLength(0)

    const [rows] = (await pool.query('SELECT COUNT(*) AS n FROM event_outbox')) as any
    expect(Number(rows[0].n)).toBe(0)
  })
})

describe('수신자가 죽어 있을 때', () => {
  it('직접 호출은 주문 접수까지 같이 실패한다', async () => {
    receiver.setMode('down')
    const r = await placeOrderDirect(pool, 20000)
    expect(r.committed).toBe(false)
  })

  it('아웃박스는 주문을 받고 나중에 보낸다', async () => {
    receiver.setMode('down')
    const r = await placeOrderOutbox(pool, queue, 20000)
    expect(r.committed).toBe(true)

    await wait(800)
    receiver.setMode('ok')
    await wait(3000)

    expect(receiver.received.some((x) => x.orderId === r.orderId)).toBe(true)
  }, 30_000)
})

describe('수신자가 느릴 때', () => {
  it('아웃박스는 호출자를 붙잡지 않는다', async () => {
    receiver.setMode('slow')
    const outbox = await placeOrderOutbox(pool, queue, 30000)
    expect(outbox.elapsedMs).toBeLessThan(1000)

    const direct = await placeOrderDirect(pool, 30000)
    expect(direct.elapsedMs).toBeGreaterThan(2500)
  }, 30_000)
})

describe('큐 적재가 빠졌을 때', () => {
  it('스위퍼가 PENDING 행을 주워 다시 올린다', async () => {
    const r = await placeOrderOutbox(pool, queue, 40000, { skipEnqueue: true })
    await wait(200)
    expect(receiver.received).toHaveLength(0)

    const swept = await sweepOnce(pool, queue, { staleMs: 0 })
    expect(swept.republished).toBe(1)

    await wait(1200)
    expect(receiver.received.some((x) => x.orderId === r.orderId)).toBe(true)
  }, 30_000)

  it('아직 오래되지 않은 행은 건드리지 않는다', async () => {
    await placeOrderOutbox(pool, queue, 40000, { skipEnqueue: true })
    const swept = await sweepOnce(pool, queue, { staleMs: 5 * 60 * 1000 })
    expect(swept.republished).toBe(0)
  })
})

describe('중복 적재', () => {
  it('같은 아웃박스 행을 두 번 올려도 한 번만 도달한다', async () => {
    const r = await placeOrderOutbox(pool, queue, 50000, { skipEnqueue: true })
    await sweepOnce(pool, queue, { staleMs: 0 })
    await sweepOnce(pool, queue, { staleMs: 0 })
    await wait(1200)

    const hits = receiver.received.filter((x) => x.orderId === r.orderId)
    expect(hits).toHaveLength(1)
  }, 30_000)
})
