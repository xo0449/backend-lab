import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { Producer } from 'kafkajs'
import { createPool, Sink } from './common.js'
import { resetSchema } from './reset.js'
import { createShipmentAppPublish, createShipmentNoOutbox, sweep } from './outbox-publish.js'
import { startCdcReader, currentPosition, type CdcReader } from './cdc-publish.js'
import { createKafka, createProducer, startConsumer, ensureTopic, type ConsumerHandle } from './kafka.js'

const pool = createPool()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const RUN = Date.now()

let producer: Producer
let consumer: ConsumerHandle
let sink: Sink
let topic: string
let seq = 0

async function publish(payload: any) {
  await producer.send({
    topic,
    messages: [{ key: payload.code, value: JSON.stringify(payload) }],
  })
}

beforeAll(async () => {
  const kafka = createKafka(`test-${RUN}`)
  topic = `test-shipments-${RUN}`
  await ensureTopic(kafka, topic)
  producer = await createProducer(kafka)
  sink = new Sink()
  consumer = await startConsumer(kafka, topic, `tg-${RUN}`, async (v) => sink.receive(v.code))
  await wait(2500)
}, 60_000)

beforeEach(async () => {
  await resetSchema(pool)
  sink.clear()
  seq += 1
})

afterAll(async () => {
  await consumer?.stop()
  await producer?.disconnect()
  await pool.end()
}, 30_000)

describe('커밋 후 발행 전에 죽었을 때', () => {
  it('아웃박스가 없으면 이벤트가 사라진다', async () => {
    const code = `no-outbox-${seq}`
    await createShipmentNoOutbox(pool, code, publish, { crashBeforePublish: true })
    await wait(1200)
    expect(sink.count(code)).toBe(0)

    // 되살릴 근거가 어디에도 없다. 주문 행만 남아 있다.
    const [rows] = (await pool.query('SELECT COUNT(*) AS n FROM shipment')) as any
    expect(Number(rows[0].n)).toBe(1)
  }, 30_000)

  it('아웃박스가 있으면 스위퍼가 되살린다', async () => {
    const code = `outbox-${seq}`
    await createShipmentAppPublish(pool, code, publish, { crashBeforePublish: true })
    await wait(800)
    expect(sink.count(code)).toBe(0)

    const { recovered } = await sweep(pool, publish)
    expect(recovered).toBe(1)

    await wait(1500)
    expect(sink.count(code)).toBeGreaterThan(0)
  }, 30_000)
})

describe('CDC로 발행할 때', () => {
  let reader: CdcReader | undefined

  it('애플리케이션에 발행 코드가 없어도 나간다', async () => {
    const seen = new Set<number>()
    reader = startCdcReader('delivery_outbox', async (row) => {
      if (seen.has(row.id)) return
      seen.add(row.id)
      await publish({ code: row.aggregate, outboxId: row.id })
    })
    await wait(1200)

    const code = `cdc-${seq}`
    await createShipmentAppPublish(pool, code, publish, { crashBeforePublish: true })
    await wait(2500)

    expect(sink.count(code)).toBeGreaterThan(0)

    // 스위퍼를 돌려도 주울 것이 없다. 이미 나갔기 때문이다.
    reader.stop()
    reader = undefined
  }, 40_000)

  it('리더가 멈춘 동안 쌓인 것을 재시작 후 따라잡는다', async () => {
    const seen = new Set<number>()
    const handler = async (row: any) => {
      if (seen.has(row.id)) return
      seen.add(row.id)
      await publish({ code: row.aggregate, outboxId: row.id })
    }

    // 리더가 오프셋을 저장해두는 상황. 실제로도 어딘가에 기록해야 한다.
    const pos = await currentPosition(pool)
    const first = startCdcReader('delivery_outbox', handler, {
      filename: pos.filename, position: pos.position,
    })
    await wait(1200)
    first.stop()
    await wait(300)

    const code = `catchup-${seq}`
    await createShipmentAppPublish(pool, code, publish, { crashBeforePublish: true })
    await wait(800)
    expect(sink.count(code)).toBe(0)

    const second = startCdcReader('delivery_outbox', handler, {
      filename: pos.filename, position: pos.position,
    })
    await wait(2500)
    expect(sink.count(code)).toBeGreaterThan(0)
    second.stop()
  }, 40_000)
})
