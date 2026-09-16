import type { AnalyticsEvent } from './event.js'

/**
 * 스트림에 쌓인 이벤트를 시각 기준으로 나눠 담는다.
 *
 * 관리형 전송 서비스는 대개 UTC로 경로를 만든다.
 * 서비스가 KST로 돌아가면 하루 경계에서 파티션이 어긋난다.
 */
export function partitionKey(iso: string, zone: 'utc' | 'kst'): string {
  const d = new Date(iso)
  if (zone === 'utc') return d.toISOString().slice(0, 10)

  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}

export function partitionAll(
  events: readonly AnalyticsEvent[],
  zone: 'utc' | 'kst',
): Map<string, AnalyticsEvent[]> {
  const out = new Map<string, AnalyticsEvent[]>()
  for (const e of events) {
    // 파티션은 수신 시각으로 나눈다. 프로듀서 시계를 믿지 않기 때문이다.
    const key = partitionKey(e.receivedAt ?? e.occurredAt, zone)
    const list = out.get(key) ?? []
    list.push(e)
    out.set(key, list)
  }
  return out
}

/**
 * 하루치를 읽는다. 파티션이 UTC인데 찾는 날짜가 KST면
 * 파티션 하나만 읽어서는 그 날의 이벤트를 다 못 모은다.
 */
export function readKstDay(
  partitions: Map<string, AnalyticsEvent[]>,
  kstDate: string,
  options: { widen: boolean },
): AnalyticsEvent[] {
  const keys = options.widen
    ? [shiftDay(kstDate, -1), kstDate, shiftDay(kstDate, 1)]
    : [kstDate]

  const candidates = keys.flatMap((k) => partitions.get(k) ?? [])

  // 넓게 읽은 뒤 이벤트 안의 KST 시각으로 정확히 거른다.
  return candidates.filter(
    (e) => partitionKey(e.receivedAt ?? e.occurredAt, 'kst') === kstDate,
  )
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
