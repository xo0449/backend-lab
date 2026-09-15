import type { CollectResult, RawEvent, Rejected, StoredEvent } from './event.js'
import type { EventBuffer } from './buffer.js'

/**
 * 받고, 최소한만 검증하고, 버퍼에 넣고, 즉시 응답한다.
 * 여기서 오래 걸리면 이벤트를 보낸 쪽이 느려진다.
 *
 * 잘못된 이벤트는 버리되 요청 전체를 실패시키지 않는다.
 * 하나가 틀렸다고 나머지를 버리면 유실이 커진다.
 */
export function createCollector(buffer: EventBuffer) {
  return function collect(events: RawEvent[]): CollectResult {
    const receivedAt = new Date().toISOString()
    const accepted: StoredEvent[] = []
    const rejected: Rejected[] = []

    for (const e of events) {
      const reason = validate(e)
      if (reason) {
        rejected.push({ eventId: e?.eventId ?? '(없음)', reason })
        continue
      }
      accepted.push({ ...e, receivedAt })
    }

    buffer.push(accepted)
    return { accepted: accepted.length, rejected }
  }
}

function validate(e: RawEvent): string | undefined {
  if (!e?.eventId) return 'eventId 없음'
  if (!e.name) return 'name 없음'
  if (typeof e.schemaVersion !== 'number') return 'schemaVersion 없음'
  return undefined
}
