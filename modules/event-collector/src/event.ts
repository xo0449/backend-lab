export interface RawEvent {
  /** 클라이언트가 만든 고유 ID. 중복 제거의 기준이 된다. */
  eventId: string
  name: string
  /** 클라이언트 시각. 신뢰하지 않는다. */
  occurredAt: string
  schemaVersion: number
  payload: Record<string, unknown>
}

export interface StoredEvent extends RawEvent {
  /** 서버가 찍는 시각. 파티셔닝은 이것으로 한다. */
  receivedAt: string
}

export interface Rejected {
  eventId: string
  reason: string
}

export interface CollectResult {
  accepted: number
  rejected: Rejected[]
}
