import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPool } from './db.js'
import { reevaluate, reevaluateWithLock } from './reevaluate.js'

const pool = createPool()

beforeAll(async () => {
  const sql = readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf8')
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt)
  }
  await pool.query(
    'INSERT INTO discount_condition (id, name, min_price) VALUES (1, ?, ?)',
    ['만원 이상', 10000],
  )
  const rows = Array.from({ length: 500 }, (_, i) => [5000 + i * 20])
  await pool.query('INSERT INTO item (price) VALUES ?', [rows])
}, 30_000)

beforeEach(async () => {
  await pool.query('TRUNCATE discount_item')
})

afterAll(async () => {
  await pool.end()
})

async function duplicateCount(): Promise<number> {
  const [rows] = (await pool.query(`
    SELECT COUNT(*) - COUNT(DISTINCT item_id) AS dup
    FROM discount_item WHERE condition_id = 1
  `)) as any
  return Number(rows[0].dup)
}

describe('동시 재평가', () => {
  it('락이 없으면 중복 행이 생긴다', async () => {
    await Promise.all([1, 2, 3, 4].map(() => reevaluate(pool, 1)))
    expect(await duplicateCount()).toBeGreaterThan(0)
  })

  it('네임드 락을 쓰면 중복이 없고 한 워커만 삽입한다', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => reevaluateWithLock(pool, 1)))
    expect(await duplicateCount()).toBe(0)
    expect(results.filter((r) => r.inserted > 0)).toHaveLength(1)
    expect(results.filter((r) => r.skipped)).toHaveLength(3)
  })
})
