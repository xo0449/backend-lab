import ZongJi from '@vlasky/zongji'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { S3Client } from '@aws-sdk/client-s3'
import { putText, clearPrefix } from '../../event-storage-layout/src/store.js'
import { REPL } from './orders.js'

export const ORDER_PREFIX = 'orders/'

export interface OrderRow {
  order_id: number
  user_id: string
  status: string
  amount: number
  created_at: string
  updated_at: string
  /** 지워진 행. 변경 로그에서만 true가 된다. */
  deleted: boolean
}

function toLine(r: any): OrderRow {
  return {
    order_id: Number(r.order_id),
    user_id: String(r.user_id),
    status: String(r.status),
    amount: Number(r.amount),
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    // 모든 파일이 이 컬럼을 갖게 한다. 한쪽에만 있으면
    // 스냅샷만 읽을 때 컬럼이 없다고 멈춘다.
    deleted: false,
  }
}

async function write(s3: S3Client, key: string, rows: OrderRow[]) {
  await putText(s3, key, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

/**
 * 방법 1. 야간 전체 덤프.
 *
 * 테이블을 통째로 읽어 파일 하나로 쓴다.
 * 만들기 제일 쉽고, 지금 이 순간의 모습이 정확히 찍힌다.
 * 대신 다음 덤프까지는 그 순간에 머문다.
 */
export async function fullDump(
  pool: Pool,
  s3: S3Client,
  label: string,
): Promise<number> {
  const prefix = `${ORDER_PREFIX}snapshot-${label}/`
  await clearPrefix(s3, prefix)
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM lab_order')
  const list = rows.map(toLine)
  for (let i = 0; i < list.length; i += 50000) {
    await write(s3, `${prefix}part-${i}.jsonl`, list.slice(i, i + 50000))
  }
  return list.length
}

/**
 * 방법 2. updated_at 으로 바뀐 것만 가져온다.
 *
 * 전부 읽지 않으니 자주 돌릴 수 있다. 여기까지는 좋다.
 * 그런데 이건 "지금 상태"만 본다.
 *
 * 한 행이 그 사이에 두 번 바뀌었으면 마지막 모습만 가져온다.
 * 지워진 행은 SELECT에 안 걸리니 영영 못 본다.
 */
export async function incrementalPoll(
  pool: Pool,
  s3: S3Client,
  since: string,
  label: string,
): Promise<number> {
  const prefix = `${ORDER_PREFIX}incremental-${label}/`
  await clearPrefix(s3, prefix)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM lab_order WHERE updated_at > ?',
    [since],
  )
  const list = rows.map(toLine)
  await write(s3, `${prefix}part-0.jsonl`, list)
  return list.length
}

export interface ChangeReader {
  stop(): void
  changes(): OrderRow[]
  /** 같은 행이 여러 번 바뀐 것까지 센다. 마지막 모습만 세면 이 수가 안 나온다. */
  eventCount(): number
}

/**
 * 방법 3. 변경 로그를 읽는다.
 *
 * DB가 복제를 위해 이미 쓰고 있는 기록을 따라 읽는다.
 * 그래서 운영 DB에 조회 부하를 거의 안 준다.
 *
 * 무엇보다 UPDATE 하나하나와 DELETE까지 다 보인다.
 * 폴링은 결과만 보고, 이쪽은 과정을 본다.
 */
export function startChangeReader(table: string): ChangeReader {
  const zongji = new (ZongJi as any)(REPL)
  const collected: OrderRow[] = []
  let events = 0

  zongji.on('binlog', (evt: any) => {
    const name = evt.getEventName()
    if (!['writerows', 'updaterows', 'deleterows'].includes(name)) return
    if (evt.tableMap[evt.tableId]?.tableName !== table) return

    for (const row of evt.rows) {
      events++
      if (name === 'updaterows') {
        collected.push(toLine(row.after))
      } else if (name === 'deleterows') {
        collected.push({ ...toLine(row), deleted: true })
      } else {
        collected.push(toLine(row))
      }
    }
  })

  zongji.on('error', () => {
    // 리더가 죽어도 프로세스를 내리지 않는다. 재시작으로 복구한다.
  })

  zongji.start({
    startAtEnd: true,
    includeEvents: ['tablemap', 'writerows', 'updaterows', 'deleterows', 'rotate'],
  })

  return {
    stop: () => zongji.stop(),
    changes: () => collected,
    eventCount: () => events,
  }
}

/**
 * 변경 로그로 모은 것을 저장소에 쓴다.
 *
 * 같은 행이 여러 번 나오므로 읽는 쪽에서 마지막 것만 골라야 한다.
 * 그 규칙을 여기가 아니라 읽는 쪽에 두는 이유는,
 * "중간에 뭘 거쳤는지"를 물을 일이 생기기 때문이다.
 */
export async function writeChanges(
  s3: S3Client,
  rows: OrderRow[],
  label: string,
): Promise<number> {
  const prefix = `${ORDER_PREFIX}changes-${label}/`
  await clearPrefix(s3, prefix)
  await write(s3, `${prefix}part-0.jsonl`, rows)
  return rows.length
}
