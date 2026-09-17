import { describe, it, expect, beforeAll } from 'vitest'
import type { DuckDBConnection } from '@duckdb/node-api'
import { createS3, ensureBucket, listObjects } from './store.js'
import { openEngine, queryOne, scannedBytesText, scannedBytesColumnar } from './scan.js'
import { seedLayouts, QUERY, PREFIX, COLUMNS, TARGET_DAY, DAYS } from './layout.js'
import { seedSmallFiles, querySmallFiles, FILE_COUNTS, bytesOf } from './smallfiles.js'
import { seedSchemaChange, renameQuery, retypeQuery, tryQuery } from './schema.js'
import { generateDay, kstDate } from './event.js'

const PER_DAY = 3000
const s3 = createS3()
let conn: DuckDBConnection

beforeAll(async () => {
  await ensureBucket(s3)
  conn = await openEngine()
  await seedLayouts(s3, conn, PER_DAY)
}, 120_000)

describe('파티션 키', () => {
  it('수신 시각을 KST로 잘라 날짜를 만든다', () => {
    // UTC로 자르면 전날이 되는 시각. KST 서비스에서는 같은 날이어야 한다.
    expect(kstDate('2026-09-15T16:30:00.000Z')).toBe('2026-09-16')
    expect(kstDate('2026-09-16T14:59:59.000Z')).toBe('2026-09-16')
    expect(kstDate('2026-09-16T15:00:00.000Z')).toBe('2026-09-17')
  })

  it('하루치는 전부 같은 KST 날짜로 떨어진다', () => {
    const events = generateDay('2026-09-16', 500, 1)
    const dates = new Set(events.map((e) => kstDate(e.received_at)))
    // 수신 시각이 발생보다 몇 초 늦을 수 있어 자정 근처가 다음 날로 넘어간다.
    expect([...dates].every((d) => d === '2026-09-16' || d === '2026-09-17')).toBe(true)
  })
})

describe('레이아웃이 달라도 답은 같다', () => {
  it('네 레이아웃이 같은 건수를 낸다', async () => {
    const answers = []
    for (const sql of Object.values(QUERY)) answers.push(await queryOne(conn, sql))
    expect(new Set(answers).size).toBe(1)
    expect(answers[0]).toBeGreaterThan(0)
  }, 120_000)
})

describe('읽는 양', () => {
  it('날짜 폴더로 나누면 하루치만 읽는다', async () => {
    const flat = await scannedBytesText(s3, [PREFIX.jsonFlat])
    const part = await scannedBytesText(s3, [`${PREFIX.jsonPart}dt=${TARGET_DAY}/`])
    // 7일치 중 하루만 읽으므로 대략 1/7이다.
    expect(part).toBeLessThan(flat / 5)
  }, 60_000)

  it('열 단위 파일은 쓰는 컬럼만 읽는다', async () => {
    const whole = (await listObjects(s3, PREFIX.parquetFlat)).reduce((s, o) => s + o.size, 0)
    const used = await scannedBytesColumnar(
      conn, `${PREFIX.parquetFlat}*.parquet`, [...COLUMNS.parquetFlat],
    )
    expect(used).toBeLessThan(whole / 2)
  }, 60_000)

  it('날짜 폴더와 열 단위를 같이 쓰면 가장 적게 읽는다', async () => {
    const jsonFlat = await scannedBytesText(s3, [PREFIX.jsonFlat])
    const both = await scannedBytesColumnar(
      conn, `${PREFIX.parquetPart}dt=${TARGET_DAY}/*.parquet`, [...COLUMNS.parquetPart],
    )
    expect(both).toBeLessThan(jsonFlat / 100)
  }, 60_000)
})

describe('파일 개수', () => {
  it('잘게 쪼개면 같은 데이터가 더 많은 자리를 차지한다', async () => {
    await seedSmallFiles(s3, conn, DAYS.indexOf(TARGET_DAY))
    const one = await bytesOf(s3, FILE_COUNTS[0])
    const many = await bytesOf(s3, FILE_COUNTS[FILE_COUNTS.length - 1])
    expect(many).toBeGreaterThan(one)
  }, 120_000)

  it('파일이 몇 개든 답은 같다', async () => {
    const answers = []
    for (const n of FILE_COUNTS) answers.push(await queryOne(conn, querySmallFiles(n)))
    expect(new Set(answers).size).toBe(1)
  }, 120_000)
})

describe('이벤트 모양이 바뀐 뒤', () => {
  beforeAll(async () => {
    await seedSchemaChange(s3, conn, DAYS.indexOf('2026-09-15'), DAYS.indexOf('2026-09-16'))
  }, 120_000)

  it('이름이 바뀌면 그냥 읽을 때는 멈춘다', async () => {
    const r = await tryQuery(conn, renameQuery(false))
    expect(r.ok).toBe(false)
  }, 60_000)

  it('이름으로 맞추면 읽히지만 절반이 조용히 빠진다', async () => {
    const r = await tryQuery(conn, renameQuery(true))
    expect(r.ok).toBe(true)
    const [rows, withValue] = r.values!
    // 읽은 행 수는 멀쩡한데 값이 있는 행은 절반이다. 에러가 안 난다.
    expect(rows).toBe(PER_DAY * 2)
    expect(withValue).toBe(PER_DAY)
  }, 60_000)

  it('타입이 바뀌면 반대로, 이름으로 맞출 때 멈춘다', async () => {
    const plain = await tryQuery(conn, retypeQuery(false))
    const byName = await tryQuery(conn, retypeQuery(true))
    expect(plain.ok).toBe(true)
    expect(byName.ok).toBe(false)
  }, 60_000)
})
