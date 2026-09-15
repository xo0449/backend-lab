import type { Pool, RowDataPacket } from 'mysql2/promise'

const LOCK_NAME = 'reevaluate:discount'

export interface ReevaluateResult {
  inserted: number
  skipped: boolean
}

/**
 * 조건에 맞는 아이템을 찾아 discount_item에 넣는다.
 *
 * 스냅샷을 읽고, 계산하고, 삽입한다. 읽기와 쓰기 사이에 틈이 있어서
 * 두 실행이 같은 스냅샷을 보면 같은 행을 두 번 넣는다.
 */
export async function reevaluate(pool: Pool, conditionId: number): Promise<ReevaluateResult> {
  const [conditions] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM discount_condition WHERE id = ?',
    [conditionId],
  )
  const condition = conditions[0]
  if (!condition) return { inserted: 0, skipped: false }

  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT item_id FROM discount_item WHERE condition_id = ?',
    [conditionId],
  )
  const already = new Set(existing.map((r) => r.item_id))

  const [targets] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM item WHERE price >= ?',
    [condition.min_price],
  )
  const toInsert = targets.filter((t) => !already.has(t.id))

  // 실제 배치의 계산 구간을 흉내낸다. 이 구간이 길수록 경합이 잘 드러난다.
  await new Promise((r) => setTimeout(r, 200))

  if (toInsert.length === 0) return { inserted: 0, skipped: false }

  await pool.query('INSERT INTO discount_item (condition_id, item_id) VALUES ?', [
    toInsert.map((t) => [conditionId, t.id]),
  ])
  return { inserted: toInsert.length, skipped: false }
}

/**
 * 네임드 락으로 인스턴스 간 한 번만 실행되게 직렬화한다.
 *
 * 주의할 점이 두 가지 있다.
 * 1. 네임드 락은 커넥션 단위다. 획득과 해제를 같은 커넥션에서 해야 한다.
 *    풀에서 매번 꺼내 쓰면 해제가 다른 커넥션에서 일어나 실패한다.
 * 2. 타임아웃 0은 즉시 반환이다. 대기하면 첫 실행이 끝난 뒤
 *    두 번째가 같은 일을 또 한다. 배치에서는 건너뛰는 편이 맞다.
 */
export async function reevaluateWithLock(
  pool: Pool,
  conditionId: number,
): Promise<ReevaluateResult> {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS ok', [LOCK_NAME])
    if (rows[0]?.ok !== 1) return { inserted: 0, skipped: true }

    try {
      return await reevaluate(pool, conditionId)
    } finally {
      // 예외가 나도 락은 반드시 푼다.
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME])
    }
  } finally {
    conn.release()
  }
}
