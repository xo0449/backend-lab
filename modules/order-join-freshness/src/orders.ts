import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'

export const MYSQL = {
  host: '127.0.0.1', port: 3307,
  user: 'root', password: 'lab', database: 'lab',
}

/** binlog를 읽으려면 복제 권한이 있는 계정이 따로 필요하다. */
export const REPL = { host: '127.0.0.1', port: 3307, user: 'repl', password: 'repl' }

export function createPool(): Pool {
  return mysql.createPool({ ...MYSQL, connectionLimit: 12 })
}

export const SCHEMA = `
  DROP TABLE IF EXISTS lab_order;
  CREATE TABLE lab_order (
    order_id   BIGINT PRIMARY KEY,
    user_id    VARCHAR(32) NOT NULL,
    status     VARCHAR(16) NOT NULL,
    amount     INT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    INDEX idx_user (user_id),
    INDEX idx_updated (updated_at)
  ) ENGINE=InnoDB;
`

export async function resetSchema(pool: Pool) {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt)
  }
}

function makeRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * 결제 화면을 본 사람 중 일부가 실제로 주문을 만든다.
 *
 * user_id를 이벤트와 같은 규칙으로 만든다. 그래야 조인이 된다.
 * 이벤트 쪽은 u-0 ~ u-19999 를 쓴다.
 */
export async function seedOrders(
  pool: Pool,
  count: number,
  day: string,
  seed = 42,
): Promise<number> {
  const rnd = makeRandom(seed)
  const dayStartUtc = Date.parse(`${day}T00:00:00+09:00`)
  const rows: any[] = []

  for (let i = 0; i < count; i++) {
    const at = new Date(dayStartUtc + Math.floor(rnd() * 24 * 3600 * 1000))
    const ts = at.toISOString().slice(0, 23).replace('T', ' ')
    rows.push([
      i + 1,
      `u-${Math.floor(rnd() * 20000)}`,
      'PAID',
      Math.floor(rnd() * 200000) + 1000,
      ts,
      ts,
    ])
  }

  for (let i = 0; i < rows.length; i += 2000) {
    await pool.query(
      'INSERT INTO lab_order (order_id, user_id, status, amount, created_at, updated_at) VALUES ?',
      [rows.slice(i, i + 2000)],
    )
  }
  return rows.length
}

/**
 * 다음 날 새벽에 일부가 취소된다.
 *
 * 결제가 끝난 뒤에 상태가 바뀌는 건 흔한 일이다.
 * 환불, 재고 부족, 결제 취소. 이게 늦은 스냅샷이 틀리는 이유가 된다.
 */
export async function cancelSome(pool: Pool, ratio: number): Promise<number> {
  // updated_at은 DB 시계로 찍는다. 애플리케이션 시계로 찍으면
  // 증분 폴링이 "언제부터"를 잡는 기준과 어긋난다.
  const [res]: any = await pool.query(
    `UPDATE lab_order SET status = 'CANCELED', updated_at = NOW(3)
     WHERE status = 'PAID' AND order_id % ? = 0`,
    [Math.max(2, Math.round(1 / ratio))],
  )
  return res.affectedRows ?? 0
}

/** 주문 한 건이 잠깐 다른 상태를 거쳐 돌아온다. 증분 폴링이 놓치는 경우다. */
export async function flipTwice(pool: Pool, orderId: number) {
  await pool.query(`UPDATE lab_order SET status='CANCELED', updated_at=NOW(3) WHERE order_id=?`, [orderId])
  await pool.query(`UPDATE lab_order SET status='PAID', updated_at=NOW(3) WHERE order_id=?`, [orderId])
}

/** 주문이 지워진다. 증분 폴링은 사라진 걸 볼 방법이 없다. */
export async function deleteOrder(pool: Pool, orderId: number) {
  await pool.query('DELETE FROM lab_order WHERE order_id = ?', [orderId])
}

export async function countByStatus(pool: Pool): Promise<Record<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT status, count(*) AS n FROM lab_order GROUP BY status',
  )
  const out: Record<string, number> = {}
  for (const r of rows) out[r.status] = Number(r.n)
  return out
}
