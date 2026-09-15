import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Sink } from './common.js'

/**
 * 방식 1. 애플리케이션이 발행한다.
 *
 * 비즈니스 변경과 아웃박스 기록을 같은 트랜잭션에 넣고,
 * 커밋한 뒤 애플리케이션이 직접 브로커에 올린다.
 *
 * 커밋과 발행 사이에 틈이 있다. 그 틈에서 프로세스가 죽으면
 * 행은 PENDING으로 남고 아무도 보내지 않는다.
 */
export async function createShipmentAppPublish(
  pool: Pool,
  code: string,
  publish: (payload: any) => Promise<void>,
  options: { crashBeforePublish?: boolean } = {},
): Promise<{ committed: boolean; published: boolean }> {
  const conn = await pool.getConnection()
  let outboxId: number

  try {
    await conn.beginTransaction()
    const [s] = await conn.query('INSERT INTO shipment (code, status) VALUES (?, ?)', [code, 'READY'])
    const shipmentId = (s as any).insertId

    const [o] = await conn.query(
      `INSERT INTO delivery_outbox (event_type, aggregate, payload, status)
       VALUES ('ShipmentReady', ?, ?, 'PENDING')`,
      [code, JSON.stringify({ shipmentId, code })],
    )
    outboxId = (o as any).insertId
    await conn.commit()
  } catch (e) {
    await conn.rollback().catch(() => {})
    throw e
  } finally {
    conn.release()
  }

  // 프로세스가 여기서 죽는 상황. 커밋은 끝났고 발행은 시작도 안 했다.
  if (options.crashBeforePublish) return { committed: true, published: false }

  await publish({ code, outboxId })
  await pool.query(
    `UPDATE delivery_outbox SET status = 'SENT' WHERE id = ? AND status = 'PENDING'`,
    [outboxId],
  )
  return { committed: true, published: true }
}

/** PENDING으로 남은 행을 주워 다시 올린다. 이 방식의 유일한 복구 경로다. */
export async function sweep(
  pool: Pool,
  publish: (payload: any) => Promise<void>,
): Promise<{ recovered: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, aggregate, payload FROM delivery_outbox
      WHERE status = 'PENDING' ORDER BY id ASC LIMIT 100`,
  )

  let recovered = 0
  for (const row of rows) {
    try {
      await publish({ code: row.aggregate, outboxId: Number(row.id) })
      await pool.query(
        `UPDATE delivery_outbox SET status = 'SENT' WHERE id = ? AND status = 'PENDING'`,
        [row.id],
      )
      recovered += 1
    } catch {
      // 다음 회차에 다시 시도한다.
    }
  }
  return { recovered }
}

/** 아웃박스 없이 커밋 후 바로 브로커에 올리는 방식. 비교를 위한 대조군이다. */
export async function createShipmentNoOutbox(
  pool: Pool,
  code: string,
  publish: (payload: any) => Promise<void>,
  options: { crashBeforePublish?: boolean } = {},
): Promise<{ committed: boolean; published: boolean }> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('INSERT INTO shipment (code, status) VALUES (?, ?)', [code, 'READY'])
    await conn.commit()
  } finally {
    conn.release()
  }

  if (options.crashBeforePublish) return { committed: true, published: false }

  await publish({ code })
  return { committed: true, published: true }
}
