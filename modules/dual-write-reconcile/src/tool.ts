import type { LabEvent } from '../../event-storage-layout/src/event.js'

/**
 * 제품 분석 도구 자리. 받은 것을 사용자별로 쌓아두고 화면으로 보여주는 쪽이다.
 *
 * 진짜로 붙이지 않는 이유는 두 가지다.
 * 계정을 만들어야 하고, 장애를 일부러 낼 수 없다.
 * 여기서 재는 건 도구의 성능이 아니라 경로가 둘일 때 생기는 일이다.
 */
export class AnalyticsTool {
  private received: LabEvent[] = []
  private seen = new Set<string>()
  private mode: 'ok' | 'down' = 'ok'
  private rejected = 0

  /** 중복을 거르는 열쇠를 볼 것인가. 끄면 재전송이 그대로 중복이 된다. */
  constructor(private readonly dedupe = true) {}

  setMode(mode: 'ok' | 'down') {
    this.mode = mode
  }

  get count() {
    return this.received.length
  }

  get rejectedCount() {
    return this.rejected
  }

  countOf(name: string): number {
    return this.received.filter((e) => e.name === name).length
  }

  clear() {
    this.received = []
    this.seen.clear()
    this.rejected = 0
  }

  /**
   * 도구는 이벤트 수로 돈을 받는다. 그래서 무엇을 보내는지가 곧 요금이다.
   *
   * 멱등 열쇠를 같이 보내면 같은 것을 두 번 보내도 한 번만 센다.
   * 재전송을 마음 놓고 하려면 이게 있어야 한다.
   */
  async send(events: LabEvent[]): Promise<void> {
    if (this.mode === 'down') {
      this.rejected += events.length
      throw new Error('analytics tool unavailable')
    }
    for (const e of events) {
      if (this.dedupe) {
        if (this.seen.has(e.event_id)) continue
        this.seen.add(e.event_id)
      }
      this.received.push(e)
    }
  }
}

/**
 * 퍼널에 실제로 쓰는 이벤트만 고른다.
 *
 * 전부 보내면 이벤트 수 과금이 그대로 늘어난다.
 * 서버가 찍는 로그성 이벤트까지 보낼 이유가 없다.
 */
export const FUNNEL_EVENTS = ['item_view', 'cart_add', 'checkout_view', 'purchase']

export function isFunnel(e: LabEvent): boolean {
  return FUNNEL_EVENTS.includes(e.name)
}
