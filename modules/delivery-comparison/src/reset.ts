import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'mysql2/promise'

export async function resetSchema(pool: Pool) {
  const sql = readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf8')
  for (const s of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
    await pool.query(s)
  }
}
