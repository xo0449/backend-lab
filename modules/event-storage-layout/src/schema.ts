import type { DuckDBConnection } from '@duckdb/node-api'
import type { S3Client } from '@aws-sdk/client-s3'
import { BUCKET, clearPrefix } from './store.js'
import { PREFIX } from './layout.js'

export const RENAME_PREFIX = 'schema-rename/'
export const RETYPE_PREFIX = 'schema-retype/'

export const OLD_DAY = '2026-09-15'
export const NEW_DAY = '2026-09-16'

/**
 * 어느 날 이벤트 모양이 바뀐 상황을 만든다.
 *
 * 두 가지를 따로 만든다. 현실에서 둘 다 일어나고,
 * 읽는 쪽에서 드러나는 방식이 정반대이기 때문이다.
 *
 * - 이름이 바뀐 경우: duration_ms 가 dwell_ms 가 됐다
 * - 타입이 바뀐 경우: amount 가 숫자에서 문자열이 됐다
 */
export async function seedSchemaChange(
  s3: S3Client,
  conn: DuckDBConnection,
  oldIndex: number,
  newIndex: number,
): Promise<void> {
  const oldSrc = `s3://${BUCKET}/${PREFIX.jsonFlat}part-${oldIndex}.jsonl`
  const newSrc = `s3://${BUCKET}/${PREFIX.jsonFlat}part-${newIndex}.jsonl`

  await clearPrefix(s3, RENAME_PREFIX)
  await conn.run(`
    COPY (SELECT event_id, name, duration_ms FROM read_json_auto('${oldSrc}'))
    TO 's3://${BUCKET}/${RENAME_PREFIX}dt=${OLD_DAY}/part-0.parquet' (FORMAT PARQUET)
  `)
  await conn.run(`
    COPY (SELECT event_id, name, duration_ms AS dwell_ms FROM read_json_auto('${newSrc}'))
    TO 's3://${BUCKET}/${RENAME_PREFIX}dt=${NEW_DAY}/part-0.parquet' (FORMAT PARQUET)
  `)

  await clearPrefix(s3, RETYPE_PREFIX)
  await conn.run(`
    COPY (SELECT event_id, name, amount FROM read_json_auto('${oldSrc}'))
    TO 's3://${BUCKET}/${RETYPE_PREFIX}dt=${OLD_DAY}/part-0.parquet' (FORMAT PARQUET)
  `)
  await conn.run(`
    COPY (SELECT event_id, name, amount::VARCHAR AS amount FROM read_json_auto('${newSrc}'))
    TO 's3://${BUCKET}/${RETYPE_PREFIX}dt=${NEW_DAY}/part-0.parquet' (FORMAT PARQUET)
  `)
}

/** 읽는 쪽이 고를 수 있는 두 가지. 이름으로 맞출 것인가 말 것인가. */
export function unionOption(byName: boolean): string {
  return byName ? ', union_by_name = true' : ''
}

export function renameQuery(byName: boolean): string {
  return `
    SELECT count(*) AS rows_read,
           count(duration_ms) AS with_value,
           round(avg(duration_ms)) AS avg_value
    FROM read_parquet('s3://${BUCKET}/${RENAME_PREFIX}*/*.parquet'${unionOption(byName)})
  `
}

export function retypeQuery(byName: boolean): string {
  return `
    SELECT count(*) AS rows_read, sum(amount) AS total
    FROM read_parquet('s3://${BUCKET}/${RETYPE_PREFIX}*/*.parquet'${unionOption(byName)})
  `
}

/** 바뀌기 전 원본에서 직접 센 값. 조용한 오답을 알아채려면 대조할 것이 있어야 한다. */
export function truthQuery(oldIndex: number, newIndex: number): string {
  const files = `['s3://${BUCKET}/${PREFIX.jsonFlat}part-${oldIndex}.jsonl', 's3://${BUCKET}/${PREFIX.jsonFlat}part-${newIndex}.jsonl']`
  return `
    SELECT count(*) AS rows_read,
           count(duration_ms) AS with_value,
           round(avg(duration_ms)) AS avg_value,
           sum(amount) AS total
    FROM read_json_auto(${files})
  `
}

export interface SchemaResult {
  ok: boolean
  values?: number[]
  error?: string
}

export async function tryQuery(conn: DuckDBConnection, sql: string): Promise<SchemaResult> {
  try {
    const reader = await conn.runAndReadAll(sql)
    const row = reader.getRows()[0]
    return { ok: true, values: row.map((v) => (v === null ? 0 : Number(v))) }
  } catch (e: any) {
    // 첫 줄만 남긴다. 스택은 여기서 볼 게 없다.
    return { ok: false, error: String(e?.message ?? e).split('\n')[0] }
  }
}
