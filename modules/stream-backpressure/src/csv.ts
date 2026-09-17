import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Order {
  id: number
  userId: number
  sku: string
  qty: number
  amount: number
  status: string
  createdAt: string
}

/**
 * 저장소 안에 100MB짜리 CSV를 두고 싶지 않아서 임시 폴더에 만든다.
 * 절대 경로라서 어느 cwd에서 돌려도 같은 파일을 본다.
 */
export const DATA_DIR = join(tmpdir(), 'backend-lab-stream')

export function csvPath(rows: number): string {
  return join(DATA_DIR, `orders-${rows}.csv`)
}

const STATUSES = ['PAID', 'SHIPPED', 'CANCELLED', 'REFUNDED']

/** 같은 건수의 파일이 이미 있으면 다시 만들지 않는다. 100만 건은 만드는 데만 몇 초 걸린다. */
export async function ensureCsv(rows: number): Promise<{ path: string; bytes: number }> {
  mkdirSync(DATA_DIR, { recursive: true })
  const path = csvPath(rows)
  if (existsSync(path)) {
    const s = statSync(path)
    if (s.size > 0) return { path, bytes: s.size }
  }

  const out = createWriteStream(path)
  let buf = 'id,user_id,sku,qty,amount,status,created_at\n'
  for (let i = 1; i <= rows; i++) {
    buf +=
      `${i},${(i % 50000) + 1},SKU-${String(i % 9999).padStart(4, '0')},` +
      `${(i % 5) + 1},${((i * 37) % 900000) + 1000},${STATUSES[i % 4]},` +
      `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z\n`
    if (buf.length > 1 << 20) {
      if (!out.write(buf)) await once(out, 'drain')
      buf = ''
    }
  }
  if (buf) out.write(buf)
  out.end()
  await once(out, 'finish')
  return { path, bytes: statSync(path).size }
}

/** 헤더 줄이면 null. 진짜 파서가 아니다. 이 모듈이 재는 건 파싱이 아니라 흐름이다. */
export function parseLine(line: string): Order | null {
  if (!line || line.charCodeAt(0) === 105 /* 'i' = 헤더 */) return null
  const f = line.split(',')
  if (f.length < 7) return null
  return {
    id: Number(f[0]),
    userId: Number(f[1]),
    sku: f[2],
    qty: Number(f[3]),
    amount: Number(f[4]),
    status: f[5],
    createdAt: f[6],
  }
}
