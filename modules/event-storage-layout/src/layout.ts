import type { DuckDBConnection } from '@duckdb/node-api'
import type { S3Client } from '@aws-sdk/client-s3'
import { BUCKET, putText, clearPrefix } from './store.js'
import { generateDay, kstDate, type LabEvent } from './event.js'

export const DAYS = [
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
]

/** 질문의 대상이 되는 하루. 가운데 날을 고른다. */
export const TARGET_DAY = '2026-09-16'
export const TARGET_NAME = 'checkout_view'

export const PREFIX = {
  jsonFlat: 'json-flat/',
  jsonPart: 'json-part/',
  parquetFlat: 'parquet-flat/',
  parquetPart: 'parquet-part/',
} as const

/**
 * 네 레이아웃에 같은 데이터를 쌓는다.
 *
 * 파일 개수와 내용을 똑같이 맞춘다. 그래야 차이가 레이아웃에서만 온다.
 * 하루치가 파일 하나다.
 */
export async function seedLayouts(
  s3: S3Client,
  conn: DuckDBConnection,
  perDay: number,
): Promise<void> {
  for (const p of Object.values(PREFIX)) await clearPrefix(s3, p)

  for (let i = 0; i < DAYS.length; i++) {
    const day = DAYS[i]
    const events = generateDay(day, perDay, i + 1)
    const body = toJsonl(events)

    // 줄 단위 파일 두 벌. 경로에 날짜가 있느냐만 다르다.
    await putText(s3, `${PREFIX.jsonFlat}part-${i}.jsonl`, body)
    await putText(s3, `${PREFIX.jsonPart}dt=${day}/part-0.jsonl`, body)
  }

  // 열 단위 파일은 이미 올라간 줄 단위 파일을 읽어 만든다.
  // 실제로도 원본을 그대로 두고 정제본을 따로 쓰는 순서다.
  for (let i = 0; i < DAYS.length; i++) {
    const day = DAYS[i]
    const src = `s3://${BUCKET}/${PREFIX.jsonFlat}part-${i}.jsonl`
    await conn.run(`
      COPY (SELECT * FROM read_json_auto('${src}'))
      TO 's3://${BUCKET}/${PREFIX.parquetFlat}part-${i}.parquet' (FORMAT PARQUET)
    `)
    await conn.run(`
      COPY (SELECT * FROM read_json_auto('${src}'))
      TO 's3://${BUCKET}/${PREFIX.parquetPart}dt=${day}/part-0.parquet' (FORMAT PARQUET)
    `)
  }
}

export function toJsonl(events: LabEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

/**
 * 파티션을 나눌 때 쓰는 키. 수신 시각을 KST로 자른다.
 * 발생 시각이 아니라 수신 시각인 이유는 프로듀서 시계를 믿지 않기 때문이다.
 */
export function partitionOf(e: LabEvent): string {
  return kstDate(e.received_at)
}

/**
 * 같은 질문을 레이아웃마다 다른 SQL로 던진다.
 *
 * 경로에 날짜가 없으면 파일 안의 시각 컬럼으로 걸러야 한다.
 * 그러면 컬럼을 하나 더 읽는다. 이 차이가 그대로 스캔량이 된다.
 */
export const QUERY = {
  jsonFlat: `
    SELECT count(*) FROM read_json_auto('s3://${BUCKET}/${PREFIX.jsonFlat}*.jsonl')
    WHERE name = '${TARGET_NAME}'
      AND strftime(received_at::TIMESTAMP + INTERVAL 9 HOUR, '%Y-%m-%d') = '${TARGET_DAY}'
  `,
  jsonPart: `
    SELECT count(*) FROM read_json_auto('s3://${BUCKET}/${PREFIX.jsonPart}*/*.jsonl', hive_partitioning = true)
    WHERE dt = '${TARGET_DAY}' AND name = '${TARGET_NAME}'
  `,
  parquetFlat: `
    SELECT count(*) FROM read_parquet('s3://${BUCKET}/${PREFIX.parquetFlat}*.parquet')
    WHERE name = '${TARGET_NAME}'
      AND strftime(received_at::TIMESTAMP + INTERVAL 9 HOUR, '%Y-%m-%d') = '${TARGET_DAY}'
  `,
  parquetPart: `
    SELECT count(*) FROM read_parquet('s3://${BUCKET}/${PREFIX.parquetPart}*/*.parquet', hive_partitioning = true)
    WHERE dt = '${TARGET_DAY}' AND name = '${TARGET_NAME}'
  `,
} as const

/**
 * 스캔량을 셀 때 어느 컬럼을 읽는지.
 *
 * 경로에서 날짜를 얻으면 시각 컬럼을 안 읽는다.
 * 파티션이 파일 수만 줄이는 게 아니라 읽는 컬럼도 줄인다.
 */
export const COLUMNS = {
  parquetFlat: ['name', 'received_at'],
  parquetPart: ['name'],
} as const
