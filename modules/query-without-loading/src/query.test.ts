import { describe, it, expect, beforeAll } from 'vitest'
import type { DuckDBConnection } from '@duckdb/node-api'
import { createS3, ensureBucket } from '../../event-storage-layout/src/store.js'
import { openEngine, scannedBytesColumnar } from '../../event-storage-layout/src/scan.js'
import { seedLayouts, DAYS } from '../../event-storage-layout/src/layout.js'
import { FORMS, PROJECTIONS, TARGET_DAY, explain, countSql, boundarySql } from './query.js'
import { buildSummary, summarySql, summaryBytes, crossover, cumulative } from './summary.js'

const PER_DAY = 50000
const s3 = createS3()
let conn: DuckDBConnection

const form = (key: string) => FORMS.find((f) => f.key === key)!

beforeAll(async () => {
  await ensureBucket(s3)
  conn = await openEngine()
  await seedLayouts(s3, conn, PER_DAY)
}, 180_000)

describe('어떻게 묻느냐가 여는 파일 수를 정한다', () => {
  it('경로의 날짜로 거르면 하루치 파일만 연다', async () => {
    const plan = await explain(conn, countSql(form('partition-eq').where))
    expect(plan.filesRead).toBe(1)
    expect(plan.pruned).toBe(true)
  }, 60_000)

  it('파일 안의 시각으로만 거르면 전부 연다', async () => {
    const plan = await explain(conn, countSql(form('timestamp-only').where))
    expect(plan.filesRead).toBe(DAYS.length)
    expect(plan.pruned).toBe(false)
  }, 60_000)

  it('경로의 날짜를 함수로 감싸도 이 엔진은 풀어낸다', async () => {
    // 엔진마다 다르다. 되는 걸 확인했다고 아무 데서나 된다고 쓰면 안 된다.
    const plan = await explain(conn, countSql(form('partition-wrapped').where))
    expect(plan.filesRead).toBe(1)
  }, 60_000)

  it('앞뒤로 하루씩만 열어도 정확한 답이 나온다', async () => {
    const wide = await explain(conn, countSql(form('both-wide').where))
    expect(wide.filesRead).toBe(3)
    expect(wide.filesRead).toBeLessThan(DAYS.length)
  }, 60_000)
})

describe('경로로 자른 하루와 시각으로 자른 하루는 다르다', () => {
  it('파티션 경계를 넘어간 행이 실제로 있다', async () => {
    const rows = (await conn.runAndReadAll(boundarySql())).getRows()
    expect(rows.length).toBeGreaterThan(0)
  }, 60_000)

  it('좁게 열면 다른 폴더에 있는 행을 놓친다', async () => {
    const narrow = await conn.runAndReadAll(countSql(form('both-narrow').where))
    const wide = await conn.runAndReadAll(countSql(form('both-wide').where))
    expect(Number(wide.getRows()[0][0])).toBeGreaterThan(Number(narrow.getRows()[0][0]))
  }, 60_000)
})

describe('무엇을 꺼내느냐가 읽는 양을 정한다', () => {
  it('파일 수가 같아도 전부 꺼내면 훨씬 많이 읽는다', async () => {
    const glob = `parquet-part/dt=${TARGET_DAY}/*.parquet`
    const star = PROJECTIONS.find((p) => p.key === 'star')!
    const only = PROJECTIONS.find((p) => p.key === 'count')!

    const a = await explain(conn, countSql(`dt = DATE '${TARGET_DAY}'`, star.select))
    const b = await explain(conn, countSql(`dt = DATE '${TARGET_DAY}'`, only.select))
    expect(a.filesRead).toBe(b.filesRead)

    const wide = await scannedBytesColumnar(conn, glob, [...star.columns])
    const narrow = await scannedBytesColumnar(conn, glob, [...only.columns])
    expect(narrow).toBeLessThan(wide / 10)
  }, 60_000)
})

describe('미리 세어두기', () => {
  beforeAll(async () => {
    await buildSummary(s3, conn)
  }, 120_000)

  it('요약본에서 읽은 답이 원본에서 센 값과 같다', async () => {
    const direct = await conn.runAndReadAll(
      countSql(`dt = DATE '${TARGET_DAY}' AND name = 'checkout_view'`),
    )
    const summary = await conn.runAndReadAll(summarySql(TARGET_DAY, 'checkout_view'))
    expect(Number(summary.getRows()[0][0])).toBe(Number(direct.getRows()[0][0]))
  }, 60_000)

  it('만드는 값을 먼저 치르므로 처음 몇 번은 원본이 싸다', async () => {
    const glob = `parquet-part/dt=${TARGET_DAY}/*.parquet`
    const direct = await scannedBytesColumnar(conn, glob, ['name'])
    const per = await summaryBytes(s3, conn)
    const build = await scannedBytesColumnar(conn, 'parquet-part/*/*.parquet', ['dt', 'name', 'amount'])

    const at = crossover(direct, build, per)
    expect(at).toBeGreaterThan(1)
    expect(cumulative(1, direct)).toBeLessThan(cumulative(1, per, build))
    expect(cumulative(at, per, build)).toBeLessThan(cumulative(at, direct))
  }, 60_000)
})
