import { createPool } from '../src/db.js'
import { NAIVE, DERIVED, DERIVED_PERIOD, INDEX_RANGE, INDEX_COVERING } from '../src/queries.js'
import { ShortCache } from '../src/cache.js'

const PERIOD: [string, string] = ['2026-06-01 00:00:00', '2026-07-01 00:00:00']
const SKIP_NAIVE = process.env.SKIP_NAIVE === '1'

async function measure(pool: any, label: string, sql: string, params: any[] = []) {
  const conn = await pool.getConnection()
  try {
    await conn.query('FLUSH STATUS')
    const started = process.hrtime.bigint()
    await conn.query(sql, params)
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    const [status] = await conn.query(`
      SHOW SESSION STATUS WHERE Variable_name IN
      ('Handler_read_next','Handler_read_rnd_next','Handler_read_key','Handler_read_first')
    `)
    const detail = Object.fromEntries(
      (status as any[]).map((r) => [r.Variable_name, Number(r.Value)]),
    )
    const rowsRead = Object.values(detail).reduce((a: number, b: any) => a + b, 0)
    return { label, elapsedMs: Math.round(elapsedMs), rowsRead, detail }
  } finally {
    conn.release()
  }
}

async function addIndex(pool: any, sql: string) {
  try {
    await pool.query(sql)
  } catch (e: any) {
    if (e.code !== 'ER_DUP_KEYNAME') throw e
  }
}

async function dropIndexes(pool: any) {
  for (const name of ['idx_payment_paid_at_refunded', 'idx_payment_covering']) {
    await pool.query(`DROP INDEX ${name} ON payment`).catch(() => {})
  }
}

async function main() {
  const pool = createPool()
  const results = []

  await dropIndexes(pool)

  if (!SKIP_NAIVE) {
    results.push(await measure(pool, '개선 전 (상관 서브쿼리)', NAIVE))
  }
  results.push(await measure(pool, '1. 파생테이블 실체화', DERIVED))
  results.push(await measure(pool, '2. 기간 필터', DERIVED_PERIOD, PERIOD))

  await addIndex(pool, INDEX_RANGE)
  results.push(await measure(pool, '3. 기간 인덱스', DERIVED_PERIOD, PERIOD))

  await addIndex(pool, INDEX_COVERING)
  results.push(await measure(pool, '4. 커버링 인덱스', DERIVED_PERIOD, PERIOD))

  // 5. 캐시. 같은 요청 8개를 동시에 보낸다.
  const cache = new ShortCache<unknown>(60_000)
  const load = () => pool.query(DERIVED_PERIOD, PERIOD)
  const started = process.hrtime.bigint()
  await Promise.all(Array.from({ length: 8 }, () => cache.get(load)))
  const cachedMs = Number(process.hrtime.bigint() - started) / 1e6
  results.push({
    label: '5. 캐시 (동시 8건)',
    elapsedMs: Math.round(cachedMs),
    rowsRead: results[results.length - 1].rowsRead,
    detail: { dbHits: cache.misses, requests: 8 },
  })

  console.table(results.map((r) => ({
    단계: r.label,
    '읽은 행': r.rowsRead.toLocaleString(),
    '실행 시간(ms)': r.elapsedMs,
  })))
  console.log(JSON.stringify(results, null, 2))
  await pool.end()
}

main()
