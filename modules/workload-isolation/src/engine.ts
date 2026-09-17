import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { BUCKET } from '../../event-storage-layout/src/store.js'

/**
 * 계산 자원 하나. 저장소는 공유하고 계산만 여기서 한다.
 *
 * 인스턴스가 스레드 풀을 들고 있다. 같은 인스턴스에 연결을 여럿 만들면
 * 그 연결들이 같은 풀을 나눠 쓴다. 인스턴스를 나누면 풀이 갈린다.
 *
 * 관리형 서비스에서 계산 자원을 나눈다는 게 이 모양이다.
 * 저장은 한 곳이고 읽는 엔진만 여럿이다.
 */
export async function openEngine(threads?: number): Promise<DuckDBConnection> {
  const conn = await (await DuckDBInstance.create(':memory:')).connect()
  await conn.run('INSTALL httpfs')
  await conn.run('LOAD httpfs')
  await conn.run(`SET s3_endpoint='127.0.0.1:9000'`)
  await conn.run(`SET s3_access_key_id='lab'`)
  await conn.run(`SET s3_secret_access_key='labsecret'`)
  await conn.run(`SET s3_use_ssl=false`)
  await conn.run(`SET s3_url_style='path'`)
  if (threads !== undefined) await conn.run(`SET threads=${threads}`)
  return conn
}

export const SOURCE = `s3://${BUCKET}/parquet-part/*/*.parquet`

/**
 * 밤에 도는 집계. 전 기간을 훑고 사용자별로 묶는다.
 * 끝나는 시각이 중요하고, 몇 초 늦어도 아무도 안 본다.
 */
export function batchSql(): string {
  return `
    SELECT user_id, count(*) AS events, sum(amount) AS amount,
           count(DISTINCT session_id) AS sessions, avg(duration_ms) AS dwell
    FROM read_parquet('${SOURCE}', hive_partitioning = true)
    GROUP BY user_id
    ORDER BY amount DESC
    LIMIT 50
  `
}

/**
 * 사람이 화면 앞에서 기다리는 조회. 하루치에서 건수를 센다.
 * 답이 늦으면 바로 안다.
 */
export function interactiveSql(day: string): string {
  return `
    SELECT count(*) FROM read_parquet('${SOURCE}', hive_partitioning = true)
    WHERE dt = DATE '${day}' AND name = 'checkout_view'
  `
}

export async function timed(conn: DuckDBConnection, sql: string): Promise<number> {
  const t0 = performance.now()
  await conn.runAndReadAll(sql)
  return performance.now() - t0
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}
