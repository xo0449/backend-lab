import type { DuckDBConnection } from '@duckdb/node-api'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { BUCKET } from '../../event-storage-layout/src/store.js'
import { ORDER_PREFIX } from './extract.js'

export const EVENT_PREFIX = 'parquet-part/'

export interface Revenue {
  viewers: number
  paidOrders: number
  amount: number
}

/**
 * 질문: 그날 결제 화면을 본 사람들이 만든 주문 중 살아있는 금액.
 *
 * 이벤트만으로는 답이 안 나온다. 화면을 봤다는 사실은 저장소에 있고
 * 그 결제가 아직 살아있는지는 운영 DB에 있다.
 *
 * 건수가 아니라 금액을 묻는 이유가 있다.
 * 사람 수는 주문 하나가 취소돼도 잘 안 움직인다.
 * 그 사람이 다른 주문을 갖고 있으면 여전히 "산 사람"이다.
 * 취소가 바로 드러나는 건 금액이다.
 */
export async function revenueFromLake(
  conn: DuckDBConnection,
  day: string,
  orderGlobs: string | string[],
): Promise<Revenue> {
  // 스냅샷과 변경 로그를 같이 읽을 때가 있다. 중괄호 묶음 대신
  // 목록으로 넘긴다. 엔진마다 묶음 문법 지원이 다르다.
  const files = (Array.isArray(orderGlobs) ? orderGlobs : [orderGlobs])
    .map((g) => `'s3://${BUCKET}/${g}'`)
    .join(', ')

  const reader = await conn.runAndReadAll(`
    WITH viewers AS (
      SELECT DISTINCT user_id
      FROM read_parquet('s3://${BUCKET}/${EVENT_PREFIX}*/*.parquet', hive_partitioning = true)
      WHERE dt = DATE '${day}' AND name = 'checkout_view'
    ),
    -- 변경 로그는 같은 주문이 여러 번 나온다. 마지막 모습만 남긴다.
    latest AS (
      SELECT * FROM (
        SELECT *, row_number() OVER (PARTITION BY order_id ORDER BY updated_at DESC) AS rn
        FROM read_json_auto([${files}], union_by_name = true)
      ) WHERE rn = 1
    ),
    live AS (
      SELECT o.* FROM latest o
      JOIN viewers v ON v.user_id = o.user_id
      WHERE o.status = 'PAID' AND coalesce(o.deleted, false) = false
    )
    SELECT (SELECT count(*) FROM viewers),
           (SELECT count(*) FROM live),
           (SELECT coalesce(sum(amount), 0) FROM live)
  `)
  const [viewers, paidOrders, amount] = reader.getRows()[0].map(Number)
  return { viewers, paidOrders, amount }
}

/**
 * 같은 질문을 운영 DB에 직접 던지면 어떻게 되는가.
 *
 * 이벤트는 저장소에 있으니 사용자 목록을 먼저 뽑아 넘겨야 한다.
 * 실제로도 이렇게 한다. 그리고 이 목록이 커지면 그대로 운영 DB의 일이 된다.
 */
export async function revenueFromDb(
  conn: DuckDBConnection,
  pool: Pool,
  day: string,
): Promise<Revenue> {
  const reader = await conn.runAndReadAll(`
    SELECT DISTINCT user_id
    FROM read_parquet('s3://${BUCKET}/${EVENT_PREFIX}*/*.parquet', hive_partitioning = true)
    WHERE dt = DATE '${day}' AND name = 'checkout_view'
  `)
  const users = reader.getRows().map((r) => String(r[0]))
  if (users.length === 0) return { viewers: 0, paidOrders: 0, amount: 0 }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT count(*) AS n, coalesce(sum(amount), 0) AS total FROM lab_order
     WHERE status = 'PAID' AND user_id IN (${users.map(() => '?').join(',')})`,
    users,
  )
  return { viewers: users.length, paidOrders: Number(rows[0].n), amount: Number(rows[0].total) }
}

/**
 * 재구매 분석. 같은 사람의 주문끼리 견줘야 답이 나오는 질문이다.
 *
 * "두 번째 주문이 첫 주문보다 작아지는 사람이 얼마나 되나" 같은 것을
 * 물으면 이 모양이 된다. 억지로 무겁게 만든 쿼리가 아니라,
 * 실제로 들어오는 질문 중에 이런 게 있다.
 *
 * 앞에서 단순 집계로 재봤을 때는 아무 일도 안 일어났다.
 * 한 번 스캔하고 끝나는 건 이 규모에서 견딘다.
 */
export async function repeatPurchaseFromDb(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT count(*) AS n FROM lab_order a
     JOIN lab_order b ON a.user_id = b.user_id AND a.order_id < b.order_id AND a.amount > b.amount`,
  )
  return Number(rows[0].n)
}

/** 같은 질문을 가져다 놓은 것에 던진다. */
export async function repeatPurchaseFromLake(
  conn: DuckDBConnection,
  glob: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(`
    WITH o AS (SELECT * FROM read_json_auto('s3://${BUCKET}/${glob}'))
    SELECT count(*) FROM o a
    JOIN o b ON a.user_id = b.user_id AND a.order_id < b.order_id AND a.amount > b.amount
  `)
  return Number(reader.getRows()[0][0])
}

/** 서비스가 평소에 던지는 가벼운 조회. 이게 밀리면 사람이 기다린다. */
export async function lightQuery(pool: Pool, userId: string): Promise<number> {
  const t0 = performance.now()
  await pool.query<RowDataPacket[]>(
    'SELECT order_id, status, amount FROM lab_order WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [userId],
  )
  return performance.now() - t0
}

export function snapshotGlob(label: string): string {
  return `${ORDER_PREFIX}snapshot-${label}/*.jsonl`
}

export function changesGlob(label: string): string {
  return `${ORDER_PREFIX}changes-${label}/*.jsonl`
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

export function won(n: number): string {
  return `${Math.round(n / 10000).toLocaleString()}만원`
}
