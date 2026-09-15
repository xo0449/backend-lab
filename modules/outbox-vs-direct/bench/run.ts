import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Queue } from 'bullmq'
import { createPool } from '../src/db.js'
import { startReceiver, type Receiver } from '../src/receiver.js'
import { placeOrderDirect } from '../src/direct.js'
import { createQueue, placeOrderOutbox } from '../src/outbox.js'
import { startWorker } from '../src/worker.js'
import { sweepOnce } from '../src/sweeper.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 시나리오마다 새 큐 이름을 쓴다.
 * 스키마를 다시 만들면 아웃박스 PK가 1부터라 jobId가 겹친다.
 * 큐를 비우는 대신 이름을 바꾸는 편이 확실하고 빠르다.
 */
async function reset(pool: any) {
  const sql = readFileSync(join(import.meta.dirname, '../src/schema.sql'), 'utf8')
  for (const s of sql.split(';').map((x) => x.trim()).filter(Boolean)) await pool.query(s)
}

async function countReceived(receiver: Receiver, orderId: number | null) {
  return receiver.received.filter((r) => r.orderId === orderId).length
}

const RUN = Date.now()

/** ONLY=2 처럼 지정하면 그 시나리오만 돌린다. 비우면 전부 돈다. */
const ONLY = process.env.ONLY ? Number(process.env.ONLY) : undefined
const runs = (n: number) => ONLY === undefined || ONLY === n

async function main() {
  const pool = createPool()
  const receiver = await startReceiver()
  const results: Record<string, unknown>[] = []

  // 시나리오 1. 커밋이 실패했는데 통보가 이미 나간 경우
  if (runs(1)) {
  await reset(pool)
  const q1 = createQueue(`lab-${RUN}-1`)
  const w1 = startWorker(pool, `lab-${RUN}-1`)
  const d1 = await placeOrderDirect(pool, 10000, { failAfterSend: true })
  const o1 = await placeOrderOutbox(pool, q1, 10000, { failAfterWrite: true })
  await wait(400)
  results.push({
    시나리오: '트랜잭션 롤백',
    '직접 호출 · 주문 저장': d1.committed ? '됨' : '안 됨',
    '직접 호출 · 통보 발송': (await countReceived(receiver, d1.orderId)) > 0 ? '나감' : '안 나감',
    '아웃박스 · 주문 저장': o1.committed ? '됨' : '안 됨',
    '아웃박스 · 통보 발송': (await countReceived(receiver, o1.orderId)) > 0 ? '나감' : '안 나감',
  })

  await w1.close(); await q1.close()
  }

  // 시나리오 2. 수신자가 죽어 있는 동안 주문이 들어온 경우
  if (runs(2)) {
  await reset(pool)
  const q2 = createQueue(`lab-${RUN}-2`)
  const w2 = startWorker(pool, `lab-${RUN}-2`)
  receiver.received.length = 0
  receiver.setMode('down')

  const d2 = await placeOrderDirect(pool, 20000)
  const o2 = await placeOrderOutbox(pool, q2, 20000)
  await wait(1500)
  receiver.setMode('ok')
  await wait(4000)

  const [pendingRows] = await pool.query(
    `SELECT status, COUNT(*) AS n FROM event_outbox GROUP BY status`,
  )
  results.push({
    시나리오: '수신자 다운 중 발생',
    '직접 호출 · 주문 저장': d2.committed ? '됨' : '안 됨',
    '직접 호출 · 최종 도달': (await countReceived(receiver, d2.orderId)) > 0 ? '도달' : '유실',
    '아웃박스 · 주문 저장': o2.committed ? '됨' : '안 됨',
    '아웃박스 · 최종 도달': (await countReceived(receiver, o2.orderId)) > 0 ? '도달' : '유실',
    '아웃박스 상태': JSON.stringify(pendingRows),
  })

  await w2.close(); await q2.close()
  }

  // 시나리오 3. 수신자가 느릴 때 호출자가 얼마나 붙잡히는가
  if (runs(3)) {
  await reset(pool)
  const q3 = createQueue(`lab-${RUN}-3`)
  const w3 = startWorker(pool, `lab-${RUN}-3`)
  receiver.received.length = 0
  receiver.setMode('slow')

  const d3 = await placeOrderDirect(pool, 30000)
  const o3 = await placeOrderOutbox(pool, q3, 30000)
  results.push({
    시나리오: '수신자 지연 3초',
    '직접 호출 응답(ms)': d3.elapsedMs,
    '아웃박스 응답(ms)': o3.elapsedMs,
  })
  receiver.setMode('ok')
  await wait(4000)

  await w3.close(); await q3.close()
  }

  // 시나리오 4. 적재가 빠진 경우 스위퍼가 줍는가
  if (runs(4)) {
  await reset(pool)
  const q4 = createQueue(`lab-${RUN}-4`)
  const w4 = startWorker(pool, `lab-${RUN}-4`)
  receiver.received.length = 0
  const o4 = await placeOrderOutbox(pool, q4, 40000, { skipEnqueue: true })
  await wait(300)
  const before = await countReceived(receiver, o4.orderId)
  const swept = await sweepOnce(pool, q4, { staleMs: 0 })
  await wait(1500)
  results.push({
    시나리오: '큐 적재 누락',
    '스위퍼 전 도달': before,
    '스위퍼가 재발행': swept.republished,
    '스위퍼 후 도달': await countReceived(receiver, o4.orderId),
  })

  await w4.close(); await q4.close()
  }

  console.log(JSON.stringify(results, null, 2))

  await receiver.close()
  await pool.end()
}

main()
