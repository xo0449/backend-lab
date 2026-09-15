import { createPool } from '../src/db.js'
import { reevaluate, reevaluateWithLock } from '../src/reevaluate.js'

const WORKERS = Number(process.env.WORKERS ?? 4)
const MODE = process.env.MODE ?? 'naive'

async function main() {
  const pool = createPool()
  const fn = MODE === 'lock' ? reevaluateWithLock : reevaluate

  await pool.query('TRUNCATE discount_item')

  const started = Date.now()
  const results = await Promise.all(
    Array.from({ length: WORKERS }, () => fn(pool, 1)),
  )
  const elapsedMs = Date.now() - started

  const [rows] = (await pool.query(`
    SELECT COUNT(*) AS total, COUNT(DISTINCT item_id) AS distinctItems
    FROM discount_item WHERE condition_id = 1
  `)) as any
  const row = rows[0]

  console.log(JSON.stringify({
    mode: MODE,
    workers: WORKERS,
    elapsedMs,
    insertedPerWorker: results.map((r) => r.inserted),
    workersThatInserted: results.filter((r) => r.inserted > 0).length,
    totalRows: row.total,
    distinctItems: row.distinctItems,
    duplicated: row.total - row.distinctItems,
  }, null, 2))

  await pool.end()
}

main()
