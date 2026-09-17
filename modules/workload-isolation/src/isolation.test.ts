import { describe, it, expect, beforeAll } from 'vitest'
import type { DuckDBConnection } from '@duckdb/node-api'
import { createS3, ensureBucket, listObjects } from '../../event-storage-layout/src/store.js'
import { openEngine as seedEngine } from '../../event-storage-layout/src/scan.js'
import { seedLayouts, TARGET_DAY } from '../../event-storage-layout/src/layout.js'
import { openEngine, batchSql, interactiveSql, timed } from './engine.js'
import { measure } from './measure.js'

const PER_DAY = 60000
const WINDOW = 2500
const s3 = createS3()
let seeder: DuckDBConnection

beforeAll(async () => {
  await ensureBucket(s3)
  seeder = await seedEngine()
  await seedLayouts(s3, seeder, PER_DAY)
}, 180_000)

describe('같은 자원에 두면 서로 민다', () => {
  it('배치가 같은 자원에서 돌면 조회가 느려진다', async () => {
    const solo = await openEngine()
    const base = await measure('기준', null, solo, TARGET_DAY, WINDOW)

    const shared = await openEngine()
    const together = await measure('같이', shared, shared, TARGET_DAY, WINDOW)

    expect(together.p95).toBeGreaterThan(base.p95)
    // 조회를 던진 횟수 자체가 준다. 한 번에 오래 붙잡히기 때문이다.
    expect(together.runs).toBeLessThan(base.runs)
  }, 120_000)

  it('자원을 나누면 덜 민다', async () => {
    const shared = await openEngine()
    const together = await measure('같이', shared, shared, TARGET_DAY, WINDOW)

    const batchOnly = await openEngine()
    const askOnly = await openEngine()
    const split = await measure('나눠서', batchOnly, askOnly, TARGET_DAY, WINDOW)

    expect(split.p95).toBeLessThan(together.p95)
  }, 120_000)
})

describe('몫을 정해두면', () => {
  it('배치를 묶으면 조회는 빨라지고 배치는 덜 돈다', async () => {
    const greedy = await openEngine()
    const ask1 = await openEngine()
    const unlimited = await measure('제한 없음', greedy, ask1, TARGET_DAY, WINDOW)

    const capped = await openEngine(1)
    const ask2 = await openEngine()
    const limited = await measure('1스레드', capped, ask2, TARGET_DAY, WINDOW)

    expect(limited.p95).toBeLessThanOrEqual(unlimited.p95)
    // 공짜가 아니다. 배치가 도는 횟수가 준다.
    expect(limited.batchRuns).toBeLessThan(unlimited.batchRuns)
  }, 120_000)
})

describe('데이터는 한 벌', () => {
  it('자원을 나눠도 같은 답이 나온다', async () => {
    const a = await openEngine()
    const b = await openEngine()
    const ra = await a.runAndReadAll(batchSql())
    const rb = await b.runAndReadAll(batchSql())
    expect(JSON.stringify(ra.getRows().map(String))).toBe(JSON.stringify(rb.getRows().map(String)))
  }, 120_000)

  it('자원을 나눠도 파일 수가 늘지 않는다', async () => {
    const before = (await listObjects(s3, 'parquet-part/')).length
    const extra = await openEngine()
    await timed(extra, interactiveSql(TARGET_DAY))
    const after = (await listObjects(s3, 'parquet-part/')).length
    expect(after).toBe(before)
  }, 120_000)
})
