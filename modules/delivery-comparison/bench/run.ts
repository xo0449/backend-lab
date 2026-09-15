/**
 * 세 가지 전달 방식을 같은 장애 상황에 넣고 비교한다.
 *
 * A. 아웃박스 없이 커밋 후 발행
 * B. 아웃박스 + 애플리케이션 발행 + 스위퍼
 * C. 아웃박스 + CDC 발행
 *
 * 브로커는 셋 다 카프카로 맞췄다. 브로커 차이가 아니라
 * 발행 경로의 차이를 보려는 것이다.
 */
import { createPool, Sink } from '../src/common.js'
import { resetSchema } from '../src/reset.js'
import {
  createShipmentAppPublish, createShipmentNoOutbox, sweep,
} from '../src/outbox-publish.js'
import { startCdcReader, currentPosition } from '../src/cdc-publish.js'
import {
  createKafka, createProducer, startConsumer, ensureTopic, resetOffset,
} from '../src/kafka.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const RUN = Date.now()
const results: Record<string, unknown>[] = []

/** ONLY=2 처럼 지정하면 그 시나리오만 돌린다. 비우면 전부 돈다. */
const ONLY = process.env.ONLY ? Number(process.env.ONLY) : undefined
const runs = (n: number) => ONLY === undefined || ONLY === n

async function main() {
  const pool = createPool()
  const kafka = createKafka(`lab-${RUN}`)
  const producer = await createProducer(kafka)

  const topic = `shipments-${RUN}`
  await ensureTopic(kafka, topic)

  const sink = new Sink()
  const consumer = await startConsumer(
    kafka, topic, `g-${RUN}`,
    async (v) => sink.receive(v.code),
  )
  await wait(2000)

  const publish = async (payload: any) => {
    await producer.send({
      topic,
      messages: [{ key: payload.code, value: JSON.stringify(payload) }],
    })
  }

  // 시나리오 1. 커밋 직후 프로세스가 죽는다
  if (runs(1)) {
  await resetSchema(pool)
  sink.clear()

  await createShipmentNoOutbox(pool, 'A-crash', publish, { crashBeforePublish: true })
  await createShipmentAppPublish(pool, 'B-crash', publish, { crashBeforePublish: true })
  await wait(1500)

  const beforeSweep = { A: sink.count('A-crash'), B: sink.count('B-crash') }
  const swept = await sweep(pool, publish)
  await wait(1500)

  results.push({
    시나리오: '커밋 후 발행 전 크래시',
    'A 아웃박스 없음': beforeSweep.A === 0 ? '유실' : '도달',
    'B 복구 전': beforeSweep.B === 0 ? '미도달' : '도달',
    'B 스위퍼 복구': swept.recovered,
    'B 복구 후': sink.count('B-crash') > 0 ? '도달' : '유실',
  })

  }

  // 시나리오 2와 3은 같은 리더를 쓴다.
  if (runs(2) || runs(3)) {
  await resetSchema(pool)
  sink.clear()

  const seen = new Set<number>()
  const handler = async (row: any) => {
    // 같은 행을 두 번 보지 않도록 리더가 기억한다.
    if (seen.has(row.id)) return
    seen.add(row.id)
    await publish({ code: row.aggregate, outboxId: row.id })
  }
  const start = await currentPosition(pool)
  const cdc = startCdcReader('delivery_outbox', handler, {
    filename: start.filename, position: start.position,
  })
  await wait(1200)

  // 애플리케이션은 발행하지 않는다. 아웃박스에 쓰기만 한다.
  await createShipmentAppPublish(pool, 'C-1', publish, { crashBeforePublish: true })
  await createShipmentAppPublish(pool, 'C-2', publish, { crashBeforePublish: true })
  await wait(2500)

  results.push({
    시나리오: 'CDC · 발행 코드 없이 커밋만',
    '도달 건수': sink.count('C-1') + sink.count('C-2'),
    '스위퍼 필요': '없음',
  })

  // 시나리오 3. CDC 리더가 멈췄다 재시작하면 밀린 것을 따라잡는가
  sink.clear()
  const pos = await currentPosition(pool)
  cdc.stop()
  await wait(300)

  await createShipmentAppPublish(pool, 'C-3', publish, { crashBeforePublish: true })
  await createShipmentAppPublish(pool, 'C-4', publish, { crashBeforePublish: true })
  await wait(800)
  const duringDown = sink.total

  const cdc2 = startCdcReader('delivery_outbox', handler, {
    filename: pos.filename, position: pos.position,
  })
  await wait(2500)

  results.push({
    시나리오: 'CDC 리더 정지 후 재시작',
    '정지 중 도달': duringDown,
    '재시작 후 도달': sink.total,
  })
  cdc2.stop()

  }

  // 시나리오 4. 카프카는 오프셋을 되감아 재처리할 수 있는가
  if (runs(4)) {
  sink.clear()
  await consumer.stop()
  await resetOffset(kafka, topic, `g-${RUN}`)

  const replaySink = new Sink()
  const replay = await startConsumer(
    kafka, topic, `g-${RUN}`,
    async (v) => replaySink.receive(v.code),
    { fromBeginning: true },
  )
  await wait(3000)

  results.push({
    시나리오: '오프셋 되감기 후 재처리',
    '다시 읽은 메시지': replaySink.total,
    '고유 건수': replaySink.unique,
  })

  await replay.stop()
  }

  console.log(JSON.stringify(results, null, 2))

  await producer.disconnect()
  await pool.end()
}

main().catch((e) => {
  console.error('실패:', e)
  process.exit(1)
})
