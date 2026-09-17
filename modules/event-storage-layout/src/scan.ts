import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { BUCKET, listObjects, type ObjectInfo } from './store.js'
import type { S3Client } from '@aws-sdk/client-s3'

/**
 * Athena 자리에 DuckDB를 놓는다.
 *
 * 둘 다 저장소에 놓인 파일을 옮기지 않고 그 자리에서 읽는다.
 * 파티션으로 파일을 걸러내고, 컬럼 단위로 읽는 것도 같다.
 * 로컬에서 돌릴 수 있어서 같은 질문을 레이아웃마다 던져볼 수 있다.
 */
export async function openEngine(): Promise<DuckDBConnection> {
  const conn = await (await DuckDBInstance.create(':memory:')).connect()
  await conn.run('INSTALL httpfs')
  await conn.run('LOAD httpfs')
  await conn.run(`SET s3_endpoint='127.0.0.1:9000'`)
  await conn.run(`SET s3_access_key_id='lab'`)
  await conn.run(`SET s3_secret_access_key='labsecret'`)
  await conn.run(`SET s3_use_ssl=false`)
  await conn.run(`SET s3_url_style='path'`)
  return conn
}

export async function queryOne(conn: DuckDBConnection, sql: string): Promise<number> {
  const reader = await conn.runAndReadAll(sql)
  return Number(reader.getRows()[0][0])
}

export interface Measured {
  rows: number
  ms: number
}

export async function measure(conn: DuckDBConnection, sql: string): Promise<Measured> {
  const t0 = performance.now()
  const rows = await queryOne(conn, sql)
  return { rows, ms: Math.round(performance.now() - t0) }
}

/**
 * 스캔량을 센다.
 *
 * 엔진이 "몇 바이트 읽었다"를 알려주지 않으므로 파일에서 되짚는다.
 * 줄 단위 파일은 통째로 읽으니 객체 크기의 합이다.
 * 열 단위 파일은 필요한 컬럼의 청크만 읽으니 그 합이다.
 *
 * 관리형 조회 서비스가 청구하는 기준이 이것과 같다.
 * 파티션으로 걸러낸 파일은 열지도 않고, 안 쓰는 컬럼은 읽지 않는다.
 */
export async function scannedBytesText(s3: S3Client, prefixes: string[]): Promise<number> {
  let total = 0
  for (const p of prefixes) {
    const objects = await listObjects(s3, p)
    total += objects.reduce((sum, o) => sum + o.size, 0)
  }
  return total
}

export async function scannedBytesColumnar(
  conn: DuckDBConnection,
  glob: string,
  columns: string[],
): Promise<number> {
  if (columns.length === 0) return 0
  const list = columns.map((c) => `'${c}'`).join(', ')
  const reader = await conn.runAndReadAll(`
    SELECT sum(total_compressed_size)
    FROM parquet_metadata('s3://${BUCKET}/${glob}')
    WHERE path_in_schema IN (${list})
  `)
  const v = reader.getRows()[0][0]
  return v === null ? 0 : Number(v)
}

export function totalSize(objects: ObjectInfo[]): number {
  return objects.reduce((sum, o) => sum + o.size, 0)
}

export function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${bytes}B`
}

/**
 * 같은 질의를 세 번 돌려 가장 빠른 값을 쓴다.
 * 첫 회는 연결과 메타데이터 읽기가 섞여 있어 레이아웃 차이를 가린다.
 */
export async function best(conn: DuckDBConnection, sql: string, times = 3): Promise<Measured> {
  let out: Measured = { rows: 0, ms: Number.MAX_SAFE_INTEGER }
  for (let i = 0; i < times; i++) {
    const r = await measure(conn, sql)
    if (r.ms < out.ms) out = r
    else out = { rows: r.rows, ms: out.ms }
  }
  return out
}
