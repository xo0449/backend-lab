import type { AnalyticsEvent, IngestResult, Rejected } from './event.js'
import type { Stream } from './stream.js'

export interface GatewayOptions {
  /**
   * true면 스트림 쓰기를 기다리지 않고 응답한다.
   * 응답은 빨라지지만 쓰기가 실패해도 클라이언트는 성공으로 안다.
   */
  fireAndForget: boolean
  /** 분당 허용 건수. 초과분은 거절한다. */
  rateLimitPerDevice?: number
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 수집 게이트웨이.
 *
 * 브라우저에서 오는 요청을 받는다. 브라우저는 신뢰 경계 밖이라
 * 여기서 걸러야 할 것이 많다. 서버에서 오는 이벤트는 이미 경계 안이라
 * 이 단계를 거치지 않는다.
 */
export class Gateway {
  private seenPerDevice = new Map<string, number>()
  private pending = new Set<Promise<void>>()

  constructor(
    private readonly stream: Stream,
    private readonly options: GatewayOptions,
  ) {}

  /** 진행 중인 쓰기가 끝날 때까지 기다린다. 측정에 쓴다. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
  }

  async ingest(
    events: AnalyticsEvent[],
    ctx: { deviceId: string; userAgent: string; origin: string },
  ): Promise<IngestResult> {
    if (isBot(ctx.userAgent)) {
      return { accepted: 0, rejected: events.map((e) => reject(e, '봇 UA')) }
    }
    if (!isAllowedOrigin(ctx.origin)) {
      return { accepted: 0, rejected: events.map((e) => reject(e, '허용되지 않은 Origin')) }
    }

    const limit = this.options.rateLimitPerDevice
    const used = this.seenPerDevice.get(ctx.deviceId) ?? 0

    const receivedAt = new Date().toISOString()
    const accepted: AnalyticsEvent[] = []
    const rejected: Rejected[] = []

    for (const e of events) {
      if (limit !== undefined && used + accepted.length >= limit) {
        rejected.push(reject(e, '요청 한도 초과'))
        continue
      }
      const reason = validate(e)
      if (reason) {
        rejected.push(reject(e, reason))
        continue
      }
      // 수신 시각은 서버가 항상 덮어쓴다. 프로듀서 시계를 믿지 않는다.
      accepted.push({ ...e, receivedAt })
    }

    this.seenPerDevice.set(ctx.deviceId, used + accepted.length)

    if (accepted.length > 0) {
      if (this.options.fireAndForget) {
        // 기다리지 않는다. 실패해도 호출자는 모른다.
        const task = this.stream.put(accepted).catch(() => {}).finally(() => {
          this.pending.delete(task)
        })
        this.pending.add(task)
      } else {
        await this.stream.put(accepted)
      }
    }

    return { accepted: accepted.length, rejected }
  }
}

function reject(e: AnalyticsEvent, reason: string): Rejected {
  return { insertId: e?.insertId ?? '(없음)', reason }
}

function validate(e: AnalyticsEvent): string | undefined {
  if (!UUID_V4.test(e.insertId ?? '')) return 'insertId 형식 오류'
  if (!e.eventType || e.eventType.length > 64) return 'eventType 길이 오류'
  if (!e.sourceApp) return 'sourceApp 없음'
  if (typeof e.schemaVersion !== 'number') return 'schemaVersion 없음'

  // 프로듀서 시계가 미래로 크게 벗어나면 받지 않는다.
  const skew = new Date(e.occurredAt).getTime() - Date.now()
  if (Number.isNaN(skew)) return 'occurredAt 형식 오류'
  if (skew > 5 * 60 * 1000) return 'occurredAt 미래 오차 초과'

  if (JSON.stringify(e).length > 32 * 1024) return '이벤트 크기 초과'
  return undefined
}

function isBot(ua: string): boolean {
  return /bot|crawler|spider|headless/i.test(ua)
}

function isAllowedOrigin(origin: string): boolean {
  return origin === 'https://example.com' || origin === 'https://www.example.com'
}
