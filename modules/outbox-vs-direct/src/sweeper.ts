import type { Queue } from 'bullmq'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { enqueue } from './outbox.js'

/**
 * 적재 구간의 유실을 줍는다.
 *
 * 커밋은 됐는데 큐 적재가 빠진 행은 PENDING으로 남는다.
 * Redis가 잠깐 죽었거나 프로세스가 그 사이에 내려간 경우다.
 * 이 구간을 메우는 경로는 이것뿐이다.
 *
 * 재적재가 안전한 이유는 jobId가 아웃박스 PK로 고정돼 있어서다.
 * 이미 대기 중인 잡이 있으면 큐가 무시한다.
 */
export async function sweepOnce(
  pool: Pool,
  queue: Queue,
  options: { staleMs?: number; batchSize?: number } = {},
): Promise<{ republished: number }> {
  const staleMs = options.staleMs ?? 5 * 60 * 1000
  const batchSize = options.batchSize ?? 100

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM event_outbox
      WHERE status = 'PENDING' AND created_at < DATE_SUB(NOW(6), INTERVAL ? MICROSECOND)
      ORDER BY id ASC LIMIT ?`,
    [staleMs * 1000, batchSize],
  )

  let republished = 0
  for (const row of rows) {
    // 한 건이 실패해도 나머지를 막지 않는다.
    try {
      await enqueue(pool, queue, Number(row.id))
      republished += 1
    } catch {
      // 다음 회차에 다시 시도한다.
    }
  }

  return { republished }
}
