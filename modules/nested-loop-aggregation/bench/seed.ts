import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPool } from '../src/db.js'

const BENEFITS = Number(process.env.BENEFITS ?? 1500)
const PAYMENTS = Number(process.env.PAYMENTS ?? 800_000)
const CHUNK = 20_000

async function main() {
  const pool = createPool()
  const sql = readFileSync(join(import.meta.dirname, '../src/schema.sql'), 'utf8')
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt)
  }

  const benefits = Array.from({ length: BENEFITS }, (_, i) => [
    `혜택 ${i + 1}`,
    '2026-01-01',
    '2026-12-31',
    1_000_000,
  ])
  await pool.query(
    'INSERT INTO benefit (name, starts_on, ends_on, budget) VALUES ?',
    [benefits],
  )

  let written = 0
  while (written < PAYMENTS) {
    const size = Math.min(CHUNK, PAYMENTS - written)
    const rows = Array.from({ length: size }, (_, i) => {
      const n = written + i
      const month = (n % 12) + 1
      const day = (n % 27) + 1
      return [
        (n % BENEFITS) + 1,
        10_000 + (n % 90_000),
        500 + (n % 4_500),
        n % 20 === 0 ? 1 : 0,
        `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 12:00:00`,
      ]
    })
    await pool.query(
      'INSERT INTO payment (benefit_id, amount, discount, refunded, paid_at) VALUES ?',
      [rows],
    )
    written += size
    process.stdout.write(`\r결제 ${written}/${PAYMENTS}`)
  }

  console.log(`\n시드 완료: 혜택 ${BENEFITS}건, 결제 ${PAYMENTS}건`)
  await pool.end()
}

main()
