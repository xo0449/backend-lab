export type ProducerType = 'client' | 'server'

export interface AnalyticsEvent {
  /** 프로듀서가 만드는 고유 ID. 전 구간 중복 제거의 기준이다. */
  insertId: string
  eventType: string
  sourceApp: string
  producerType: ProducerType
  /** 이벤트가 일어난 시각. 프로듀서가 찍는다. */
  occurredAt: string
  /** 수집기가 찍는 시각. 파티션 기준이 된다. */
  receivedAt?: string
  schemaVersion: number
  payload: Record<string, unknown>
}

export interface Rejected {
  insertId: string
  reason: string
}

export interface IngestResult {
  accepted: number
  rejected: Rejected[]
}
