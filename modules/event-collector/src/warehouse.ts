import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import type { StoredEvent } from './event.js'

/**
 * Redshift 자리에 DuckDB를 놓는다. 로컬에서 띄울 수 있고 SQL이 비슷하다.
 */
export async function openWarehouse(path = ':memory:'): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(path)
  const conn = await instance.connect()
  await conn.run(`
    CREATE TABLE IF NOT EXISTS event (
      event_id       VARCHAR PRIMARY KEY,
      name           VARCHAR,
      occurred_at    VARCHAR,
      received_at    VARCHAR,
      schema_version INTEGER,
      payload        VARCHAR
    )
  `)
  return conn
}

/**
 * 적재는 멱등이어야 한다. 같은 파일을 두 번 넣어도 결과가 같아야
 * 재시도를 마음 놓고 할 수 있다. eventId를 기준으로 거른다.
 *
 * 중복 제거를 수집 단계가 아니라 여기서 하는 이유가 있다.
 * 수집 단계에서 걸면 무엇을 이미 받았는지 상태를 들고 있어야 하고,
 * 그만큼 응답이 느려진다. 수집은 빨라야 한다.
 */
export async function loadEvents(
  conn: DuckDBConnection,
  events: StoredEvent[],
): Promise<{ inserted: number }> {
  const before = await countEvents(conn)
  for (const e of events) {
    await conn.run(
      `INSERT INTO event VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [e.eventId, e.name, e.occurredAt, e.receivedAt, e.schemaVersion, JSON.stringify(e.payload)],
    )
  }
  // 드라이버가 INSERT의 변경 행 수를 주지 않는다. 전후 건수 차이로 센다.
  return { inserted: (await countEvents(conn)) - before }
}

export async function countEvents(conn: DuckDBConnection): Promise<number> {
  const reader = await conn.runAndReadAll('SELECT COUNT(*) AS n FROM event')
  return Number(reader.getRows()[0][0])
}
