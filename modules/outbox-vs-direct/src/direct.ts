import type { Pool } from 'mysql2/promise'
import { endpoint } from './endpoint.js'



export interface DirectResult {
  orderId: number | null
  committed: boolean
  sent: boolean
  elapsedMs: number
  error?: string
}

/**
 * 개선 전. 비즈니스 트랜잭션 안에서 외부 서버를 직접 호출한다.
 *
 * 이 방식에는 두 가지 문제가 같이 들어 있다.
 * 1. 외부 서버가 느리면 트랜잭션이 그만큼 열려 있다
 * 2. 호출은 성공했는데 뒤이어 커밋이 실패하면 없던 일에 대한 통보가 나간다
 */
export async function placeOrderDirect(
  pool: Pool,
  amount: number,
  options: { failAfterSend?: boolean } = {},
): Promise<DirectResult> {
  const started = Date.now()
  const conn = await pool.getConnection()
  let orderId: number | null = null
  let sent = false

  try {
    await conn.beginTransaction()

    const [result] = await conn.query(
      'INSERT INTO `order` (amount, status) VALUES (?, ?)',
      [amount, 'PAID'],
    )
    orderId = (result as any).insertId

    // 트랜잭션 안에서 외부 호출을 한다.
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, eventType: 'OrderPlaced', amount }),
    })
    if (!res.ok) throw new Error(`수신자 응답 ${res.status}`)
    sent = true

    if (options.failAfterSend) {
      // 재고 차감 실패 같은 후속 단계의 오류를 흉내낸다.
      throw new Error('후속 단계 실패')
    }

    await conn.commit()
    return { orderId, committed: true, sent, elapsedMs: Date.now() - started }
  } catch (e) {
    await conn.rollback().catch(() => {})
    return {
      orderId,
      committed: false,
      sent,
      elapsedMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    conn.release()
  }
}
