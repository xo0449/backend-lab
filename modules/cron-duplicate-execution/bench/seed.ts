import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPool } from '../src/db.js'

const ITEM_COUNT = Number(process.env.ITEMS ?? 2000)

async function main() {
  const pool = createPool()
  const sql = readFileSync(join(import.meta.dirname, '../src/schema.sql'), 'utf8')

  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt)
  }

  await pool.query(
    'INSERT INTO discount_condition (id, name, min_price) VALUES (1, ?, ?)',
    ['만원 이상', 10000],
  )

  const rows = Array.from({ length: ITEM_COUNT }, (_, i) => [5000 + i * 10])
  await pool.query('INSERT INTO item (price) VALUES ?', [rows])

  const [[row]] = (await pool.query(
    'SELECT COUNT(*) AS n FROM item WHERE price >= 10000',
  )) as any
  console.log(`시드 완료: 아이템 ${ITEM_COUNT}건, 조건 대상 ${row.n}건`)
  await pool.end()
}

main()
