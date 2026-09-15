/**
 * 스키마가 바뀌면 무엇이 깨지는가.
 *
 * v1 이벤트와 v2 이벤트를 같이 보내고, 한 테이블에 들어간 뒤
 * 옛 형식을 읽는 쿼리가 어떻게 되는지 본다.
 */
import { randomUUID } from 'node:crypto'
import { EventBuffer } from '../src/buffer.js'
import { createCollector } from '../src/collector.js'
import { createS3, ensureBucket, createS3Sink, listKeys, readEvents } from '../src/sink.js'
import { openWarehouse, loadEvents } from '../src/warehouse.js'
import type { RawEvent } from '../src/event.js'

const v1 = (): RawEvent => ({
  eventId: randomUUID(),
  name: 'item_viewed',
  occurredAt: new Date().toISOString(),
  schemaVersion: 1,
  payload: { itemId: 42 },
})

// v2는 itemId를 items 배열로 바꿨다. 흔한 형태의 변경이다.
const v2 = (): RawEvent => ({
  eventId: randomUUID(),
  name: 'item_viewed',
  occurredAt: new Date().toISOString(),
  schemaVersion: 2,
  payload: { items: [42, 43] },
})

async function main() {
  const s3 = createS3()
  await ensureBucket(s3)

  const before = new Set(await listKeys(s3))
  const buffer = new EventBuffer(createS3Sink(s3), { maxEvents: 1000, maxAgeMs: 50 })
  const collect = createCollector(buffer)

  collect([v1(), v1(), v2(), v2(), v2()])
  await buffer.flush()

  const fresh = (await listKeys(s3)).filter((k) => !before.has(k))
  const conn = await openWarehouse()
  for (const key of fresh) await loadEvents(conn, await readEvents(s3, key))

  const byVersion = await conn.runAndReadAll(
    'SELECT schema_version, COUNT(*) AS n FROM event GROUP BY 1 ORDER BY 1',
  )
  console.log('버전별 적재:', byVersion.getRows())

  // 옛 형식만 아는 쿼리. v2 행에서는 itemId가 없어 NULL이 된다.
  const naive = await conn.runAndReadAll(`
    SELECT COUNT(*) AS total,
           COUNT(json_extract(payload, '$.itemId')) AS has_item_id
      FROM event
  `)
  console.log('itemId를 읽는 쿼리:', naive.getRows())

  // 두 버전을 함께 다루는 쿼리.
  const tolerant = await conn.runAndReadAll(`
    SELECT SUM(CASE
             WHEN schema_version = 1 THEN 1
             WHEN schema_version >= 2 THEN json_array_length(json_extract(payload, '$.items'))
           END) AS viewed_items
      FROM event
  `)
  console.log('두 버전을 함께 읽는 쿼리:', tolerant.getRows())
}

main()
