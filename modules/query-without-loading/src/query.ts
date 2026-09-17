import type { DuckDBConnection } from '@duckdb/node-api'
import { BUCKET } from '../../event-storage-layout/src/store.js'

/**
 * 앞 모듈이 쌓아둔 모양을 그대로 읽는다.
 *
 * 같은 적재 코드를 복사해오면 둘이 조금씩 어긋나고,
 * 그러면 "조회 방식 때문에 달라진 것"과 "쌓은 게 달라서 달라진 것"을
 * 구분할 수 없게 된다. 여기서는 쌓는 쪽을 고정해야 한다.
 */
export const SOURCE = `s3://${BUCKET}/parquet-part/*/*.parquet`

export const TARGET_DAY = '2026-09-16'

/**
 * 하루치를 물어보는 여섯 가지 방법.
 *
 * 전부 같은 답이 나온다. 다른 건 몇 개의 파일을 여느냐다.
 */
export const FORMS = [
  {
    key: 'partition-eq',
    label: '경로의 날짜로 콕 집어',
    where: `dt = DATE '${TARGET_DAY}'`,
  },
  {
    key: 'partition-range',
    label: '경로의 날짜를 범위로',
    where: `dt >= DATE '${TARGET_DAY}' AND dt < DATE '${TARGET_DAY}' + INTERVAL 1 DAY`,
  },
  {
    key: 'partition-wrapped',
    label: '경로의 날짜를 함수로 감싸',
    where: `strftime(dt, '%Y-%m-%d') = '${TARGET_DAY}'`,
  },
  {
    key: 'timestamp-only',
    label: '파일 안의 시각으로 (최근 24시간)',
    where: `received_at >= TIMESTAMP '${TARGET_DAY} 00:00:00' - INTERVAL 9 HOUR
            AND received_at < TIMESTAMP '${TARGET_DAY} 00:00:00' + INTERVAL 15 HOUR`,
  },
  {
    key: 'timestamp-cast',
    label: '시각을 날짜로 바꿔서',
    where: `CAST(received_at + INTERVAL 9 HOUR AS DATE) = DATE '${TARGET_DAY}'`,
  },
  {
    key: 'both-narrow',
    label: '하루만 열고 시각으로 마무리',
    where: `dt = DATE '${TARGET_DAY}'
            AND CAST(received_at + INTERVAL 9 HOUR AS DATE) = DATE '${TARGET_DAY}'`,
  },
  {
    key: 'both-wide',
    label: '앞뒤로 하루씩 열고 마무리',
    where: `dt >= DATE '${TARGET_DAY}' - INTERVAL 1 DAY
            AND dt <= DATE '${TARGET_DAY}' + INTERVAL 1 DAY
            AND CAST(received_at + INTERVAL 9 HOUR AS DATE) = DATE '${TARGET_DAY}'`,
  },
] as const

/**
 * 파티션은 파일이 만들어진 시점으로 갈린다.
 * 자정 직전에 들어온 이벤트가 자정 직후 파일에 들어가는 일이 생긴다.
 *
 * 그래서 "경로로 자른 하루"와 "시각으로 자른 하루"가 완전히 같지 않다.
 * 어느 쪽이 맞는지는 질문이 정한다. 틀린 게 아니라 다른 걸 세는 것이다.
 */
export function boundarySql(day = TARGET_DAY): string {
  return `
    SELECT dt, CAST(received_at + INTERVAL 9 HOUR AS DATE) AS kst, count(*) AS n
    FROM read_parquet('${SOURCE}', hive_partitioning = true)
    WHERE dt BETWEEN DATE '${day}' - INTERVAL 1 DAY AND DATE '${day}' + INTERVAL 1 DAY
    GROUP BY 1, 2 HAVING dt <> kst ORDER BY 1, 2
  `
}

export interface Plan {
  filesRead: number
  pruned: boolean
}

/**
 * 엔진에게 몇 개의 파일을 열었는지 직접 묻는다.
 *
 * 파일 크기에서 되짚어 세면 "이만큼 읽었을 것이다"까지만 말할 수 있다.
 * 프루닝이 실제로 걸렸는지는 엔진만 안다.
 */
export async function explain(conn: DuckDBConnection, sql: string): Promise<Plan> {
  const reader = await conn.runAndReadAll(`EXPLAIN ANALYZE ${sql}`)
  const text = String(reader.getRows()[0][1])
  return {
    filesRead: Number(text.match(/Files Read:\s*(\d+)/)?.[1] ?? -1),
    pruned: /File Filters/.test(text),
  }
}

export function countSql(where: string, select = 'count(*)'): string {
  return `
    SELECT ${select} FROM read_parquet('${SOURCE}', hive_partitioning = true)
    WHERE ${where}
  `
}

/**
 * 무엇을 SELECT 하느냐로 읽는 컬럼이 갈린다.
 * 파일 수가 같아도 읽는 양은 다르다.
 */
export const PROJECTIONS = [
  { key: 'star', label: 'SELECT *', select: '*', columns: ALL_COLUMNS() },
  {
    key: 'three',
    label: '세 컬럼만',
    select: 'name, user_id, amount',
    columns: ['name', 'user_id', 'amount'],
  },
  { key: 'count', label: '건수만', select: 'count(*)', columns: ['name'] },
] as const

export function ALL_COLUMNS(): string[] {
  return [
    'event_id', 'name', 'user_id', 'device', 'path', 'referrer',
    'session_id', 'duration_ms', 'amount', 'occurred_at', 'received_at',
  ]
}
