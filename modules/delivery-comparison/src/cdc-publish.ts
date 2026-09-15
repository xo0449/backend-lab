import ZongJi from '@vlasky/zongji'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { REPL } from './common.js'

/**
 * 지금 binlog의 끝 위치를 읽는다.
 *
 * 리더는 자기가 어디까지 읽었는지를 어딘가에 저장해야 한다.
 * 저장을 안 하면 재시작할 때 처음부터 읽거나 끝에서 시작하는데,
 * 전자는 전부 중복이고 후자는 멈춘 동안의 것을 잃는다.
 */
export async function currentPosition(
  pool: Pool,
): Promise<{ filename: string; position: number }> {
  const [rows] = await pool.query<RowDataPacket[]>('SHOW MASTER STATUS')
  const row = rows[0]
  return { filename: row.File, position: Number(row.Position) }
}

export interface CdcReader {
  stop(): void
  /** 마지막으로 읽은 위치. 재시작 지점이 된다. */
  position(): { filename?: string; position?: number }
}

/**
 * 방식 2. 변경 로그를 읽어 발행한다.
 *
 * 애플리케이션은 아웃박스에 쓰기만 한다. 발행 코드를 갖지 않는다.
 * 리더가 binlog에서 그 INSERT를 보고 브로커에 올린다.
 *
 * 커밋과 발행 사이의 틈이 구조적으로 사라진다.
 * 행이 커밋됐다면 로그에 있고, 로그에 있으면 언젠가 읽힌다.
 * 대신 리더가 새 인프라가 되고, 위치를 잃으면 중복이나 유실이 생긴다.
 */
export function startCdcReader(
  table: string,
  onRow: (row: any) => Promise<void>,
  options: { startAtEnd?: boolean; filename?: string; position?: number } = {},
): CdcReader {
  const zongji = new (ZongJi as any)(REPL)
  let filename: string | undefined = options.filename
  let position: number | undefined = options.position

  zongji.on('binlog', (evt: any) => {
    filename = evt.binlogName ?? filename
    position = evt.nextPosition ?? position

    if (evt.getEventName() !== 'writerows') return
    if (evt.tableMap[evt.tableId]?.tableName !== table) return

    for (const row of evt.rows) {
      void onRow(row)
    }
  })

  zongji.on('error', () => {
    // 리더가 죽어도 프로세스를 내리지 않는다. 재시작으로 복구한다.
  })

  const start: any = { includeEvents: ['tablemap', 'writerows', 'rotate'] }
  if (options.filename && options.position) {
    start.filename = options.filename
    start.position = options.position
  } else {
    start.startAtEnd = options.startAtEnd ?? true
  }
  zongji.start(start)

  return {
    stop: () => zongji.stop(),
    position: () => ({ filename, position }),
  }
}
