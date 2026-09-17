import type { DuckDBConnection } from '@duckdb/node-api'
import type { S3Client } from '@aws-sdk/client-s3'
import { BUCKET, clearPrefix, listObjects } from './store.js'
import { PREFIX, TARGET_NAME } from './layout.js'

/**
 * 같은 하루치를 파일 개수만 바꿔 쌓는다.
 *
 * 전송 서비스의 버퍼를 짧게 잡으면 파일이 잘게 쪼개진다.
 * 1분마다 쓰면 하루에 1440개다. 그게 무슨 값을 치르는지 본다.
 */
export const FILE_COUNTS = [1, 24, 240] as const

export function prefixFor(n: number): string {
  return `smallfiles-${n}/`
}

export function globFor(n: number): string {
  return n === 1 ? `${prefixFor(n)}*.parquet` : `${prefixFor(n)}*/*.parquet`
}

export async function seedSmallFiles(
  s3: S3Client,
  conn: DuckDBConnection,
  dayIndex: number,
): Promise<void> {
  const src = `s3://${BUCKET}/${PREFIX.jsonFlat}part-${dayIndex}.jsonl`

  for (const n of FILE_COUNTS) {
    const prefix = prefixFor(n)
    await clearPrefix(s3, prefix)

    if (n === 1) {
      await conn.run(`
        COPY (SELECT * FROM read_json_auto('${src}'))
        TO 's3://${BUCKET}/${prefix}part-0.parquet' (FORMAT PARQUET)
      `)
      continue
    }

    // 한 번의 COPY로 N개를 쓴다. 파일마다 따로 쓰면 그 자체가 오래 걸려
    // 측정이 쓰기 시간에 묻힌다.
    await conn.run(`
      COPY (SELECT *, (row_number() OVER ()) % ${n} AS chunk FROM read_json_auto('${src}'))
      TO 's3://${BUCKET}/${prefix}' (FORMAT PARQUET, PARTITION_BY (chunk))
    `)
  }
}

export function querySmallFiles(n: number): string {
  return `
    SELECT count(*) FROM read_parquet('s3://${BUCKET}/${globFor(n)}')
    WHERE name = '${TARGET_NAME}'
  `
}

export async function bytesOf(s3: S3Client, n: number): Promise<number> {
  const objects = await listObjects(s3, prefixFor(n))
  return objects.reduce((sum, o) => sum + o.size, 0)
}
