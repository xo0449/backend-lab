import { Worker, UnrecoverableError } from 'bullmq'
import type { Pool } from 'mysql2/promise'
import { endpoint } from './endpoint.js'
import { REDIS } from './db.js'
import { QUEUE_NAME } from './outbox.js'



/**
 * 아웃박스 이벤트를 꺼내 외부로 보낸다.
 *
 * 재시도는 BullMQ가 소유한다. HTTP 계층에서 따로 재시도하지 않는다.
 * 두 곳에서 재시도하면 실제 시도 횟수가 곱해진다.
 */
export function startWorker(pool: Pool, name = QUEUE_NAME) {
  return new Worker(
    name,
    async (job) => {
      const res = await fetch(endpoint(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job.data),
      })

      // 400대는 다시 보내도 같은 답이 온다. 재시도하지 않고 바로 실패로 보낸다.
      if (res.status >= 400 && res.status < 500) {
        throw new UnrecoverableError(`영구 거부 ${res.status}`)
      }
      if (!res.ok) throw new Error(`수신자 응답 ${res.status}`)

      await pool.query(
        `UPDATE event_outbox SET status = 'COMPLETED'
          WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED')`,
        [job.data.outboxId],
      )
    },
    { connection: REDIS, concurrency: 1 },
  ).on('failed', async (job, err) => {
    if (!job) return
    const isFinal =
      job.finishedOn !== undefined ||
      err instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1)
    if (!isFinal) return

    await pool.query(
      `UPDATE event_outbox SET status = 'FAILED'
        WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED')`,
      [job.data.outboxId],
    )
  })
}
