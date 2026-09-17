import type { DuckDBConnection } from '@duckdb/node-api'
import type { S3Client } from '@aws-sdk/client-s3'
import { BUCKET, clearPrefix, listObjects } from '../../event-storage-layout/src/store.js'
import { SOURCE } from './query.js'

export const SUMMARY_PREFIX = 'summary-daily/'

/**
 * 하루 한 번 미리 세어두는 요약본.
 *
 * 3편에서 "자주 보는 것만 안으로 넣는다"라고 적었던 것의 가장 싼 형태다.
 * 웨어하우스를 들이지 않아도, 같은 저장소에 작은 파일 하나를 더 쓰면 된다.
 */
export async function buildSummary(s3: S3Client, conn: DuckDBConnection): Promise<void> {
  await clearPrefix(s3, SUMMARY_PREFIX)
  await conn.run(`
    COPY (
      SELECT dt, name, count(*) AS events, sum(amount) AS amount
      FROM read_parquet('${SOURCE}', hive_partitioning = true)
      GROUP BY dt, name
    ) TO 's3://${BUCKET}/${SUMMARY_PREFIX}daily.parquet' (FORMAT PARQUET)
  `)
}

export function summarySql(day: string, name: string): string {
  return `
    SELECT events FROM read_parquet('s3://${BUCKET}/${SUMMARY_PREFIX}daily.parquet')
    WHERE dt = DATE '${day}' AND name = '${name}'
  `
}

export async function summaryBytes(s3: S3Client, conn: DuckDBConnection): Promise<number> {
  const objects = await listObjects(s3, SUMMARY_PREFIX)
  const whole = objects.reduce((sum, o) => sum + o.size, 0)
  // 요약본은 파일이 하나뿐이라 파티션이 없다. 질문마다 events 컬럼과
  // 거르는 데 쓰는 두 컬럼을 읽는다.
  const reader = await conn.runAndReadAll(`
    SELECT sum(total_compressed_size)
    FROM parquet_metadata('s3://${BUCKET}/${SUMMARY_PREFIX}daily.parquet')
    WHERE path_in_schema IN ('dt', 'name', 'events')
  `)
  const used = reader.getRows()[0][0]
  return used === null ? whole : Number(used)
}

/**
 * 같은 질문을 n번 던졌을 때 지금까지 읽은 양.
 *
 * 요약본 쪽은 만들 때 한 번 전부 읽는다. 그 값을 먼저 치르고
 * 그다음부터 싸진다. 교차점이 어디인지가 이 실험의 질문이다.
 */
export function cumulative(n: number, perQuery: number, upfront = 0): number {
  return upfront + n * perQuery
}

export function crossover(directPerQuery: number, buildCost: number, summaryPerQuery: number): number {
  const saved = directPerQuery - summaryPerQuery
  if (saved <= 0) return Number.POSITIVE_INFINITY
  return Math.ceil(buildCost / saved)
}
