import { Kafka, logLevel, type Consumer, type Producer } from 'kafkajs'
import { KAFKA_BROKER } from './common.js'

export function createKafka(clientId: string) {
  return new Kafka({ clientId, brokers: [KAFKA_BROKER], logLevel: logLevel.NOTHING })
}

export async function createProducer(kafka: Kafka): Promise<Producer> {
  const producer = kafka.producer()
  await producer.connect()
  return producer
}

export interface ConsumerHandle {
  consumer: Consumer
  stop(): Promise<void>
}

/**
 * 컨슈머 그룹으로 읽는다.
 *
 * 큐와 다른 점은 읽어도 메시지가 사라지지 않는다는 것이다.
 * 사라지는 것은 오프셋뿐이고, 오프셋은 되돌릴 수 있다.
 * 그래서 소비자 버그를 고친 뒤 과거 구간을 다시 처리할 수 있다.
 */
export async function startConsumer(
  kafka: Kafka,
  topic: string,
  groupId: string,
  onMessage: (value: any) => Promise<void>,
  options: { fromBeginning?: boolean } = {},
): Promise<ConsumerHandle> {
  const consumer = kafka.consumer({ groupId, sessionTimeout: 6000 })
  await consumer.connect()
  await consumer.subscribe({ topic, fromBeginning: options.fromBeginning ?? true })

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return
      await onMessage(JSON.parse(message.value.toString()))
    },
  })

  return {
    consumer,
    stop: async () => {
      await consumer.disconnect()
    },
  }
}

export async function ensureTopic(kafka: Kafka, topic: string, partitions = 1) {
  const admin = kafka.admin()
  await admin.connect()
  const existing = await admin.listTopics()
  if (!existing.includes(topic)) {
    await admin.createTopics({
      topics: [{ topic, numPartitions: partitions, replicationFactor: 1 }],
      waitForLeaders: true,
    })
  }
  await admin.disconnect()
}

/**
 * 오프셋을 되감는다. 큐에는 없는 동작이다.
 * 이미 처리한 구간을 다시 읽어 재처리한다.
 */
export async function resetOffset(kafka: Kafka, topic: string, groupId: string) {
  const admin = kafka.admin()
  await admin.connect()
  await admin.resetOffsets({ groupId, topic, earliest: true })
  await admin.disconnect()
}
