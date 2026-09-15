import { Queue } from 'bullmq'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { REDIS } from './db.js'

export const QUEUE_NAME = 'order-events'

export type OutboxStatus = 'PENDING' | 'ENQUEUED' | 'COMPLETED' | 'FAILED'

export interface OutboxResult {
  orderId: number | null
  committed: boolean
  outboxId: number | null
  elapsedMs: number
  error?: string
}

export function createQueue(name = QUEUE_NAME) {
  return new Queue(name, {
    connection: REDIS,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 300 },
      removeOnComplete: { age: 3600 },
      // 실패한 잡이 곧 DLQ다. 지우면 유실을 감지할 수 없다.
      removeOnFail: false,
    },
  })
}

/**
 * 개선 후. 외부 호출을 트랜잭션 밖으로 밀어낸다.
 *
 * 비즈니스 변경과 아웃박스 기록은 같은 트랜잭션이다.
 * 둘은 같이 커밋되거나 같이 사라진다. 없던 일에 대한 통보가 나갈 수 없다.
 *
 * 큐 적재는 커밋 뒤에 한다. 적재가 실패해도 아웃박스는 PENDING으로 남아
 * 스위퍼가 주워간다. 그래서 여기서는 실패를 삼킨다.
 */
export async function placeOrderOutbox(
  pool: Pool,
  queue: Queue,
  amount: number,
  options: { failAfterWrite?: boolean; skipEnqueue?: boolean } = {},
): Promise<OutboxResult> {
  const started = Date.now()
  const conn = await pool.getConnection()
  let orderId: number | null = null
  let outboxId: number | null = null

  try {
    await conn.beginTransaction()

    const [orderResult] = await conn.query(
      'INSERT INTO `order` (amount, status) VALUES (?, ?)',
      [amount, 'PAID'],
    )
    orderId = (orderResult as any).insertId

    const [outboxResult] = await conn.query(
      `INSERT INTO event_outbox (event_type, dedup_key, payload, status)
       VALUES (?, ?, ?, 'PENDING')`,
      ['OrderPlaced', `OrderPlaced:${orderId}`,
       JSON.stringify({ orderId, eventType: 'OrderPlaced', amount })],
    )
    outboxId = (outboxResult as any).insertId

    if (options.failAfterWrite) throw new Error('후속 단계 실패')

    await conn.commit()
  } catch (e) {
    await conn.rollback().catch(() => {})
    return {
      orderId, committed: false, outboxId: null,
      elapsedMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    conn.release()
  }

  // 커밋 후 적재. skipEnqueue는 Redis 장애나 프로세스 종료를 흉내낸다.
  if (!options.skipEnqueue) {
    await enqueue(pool, queue, outboxId!).catch(() => {
      // 삼킨다. PENDING으로 남아 스위퍼가 복구한다.
    })
  }

  return { orderId, committed: true, outboxId, elapsedMs: Date.now() - started }
}

export async function enqueue(pool: Pool, queue: Queue, outboxId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM event_outbox WHERE id = ?', [outboxId],
  )
  const row = rows[0]
  if (!row) return

  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload

  // jobId를 아웃박스 PK로 고정한다. 같은 행을 두 번 적재해도 잡은 하나다.
  await queue.add(row.event_type, { ...payload, outboxId }, { jobId: `outbox-${outboxId}` })

  // 조건부 갱신. 소비자가 먼저 끝냈으면 상태를 되돌리지 않는다.
  await pool.query(
    `UPDATE event_outbox SET status = 'ENQUEUED' WHERE id = ? AND status = 'PENDING'`,
    [outboxId],
  )
}
