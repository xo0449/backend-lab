import type { AnalyticsEvent } from './event.js'

/**
 * 스트림 대역. 관리형 스트림을 흉내낸다.
 *
 * 장애를 만들 수 있어야 유실을 측정할 수 있다.
 * down이면 쓰기가 실패하고, slow면 응답이 늦는다.
 */
export class Stream {
  private records: AnalyticsEvent[] = []
  private mode: 'ok' | 'down' | 'slow' = 'ok'
  private failedWrites = 0

  setMode(mode: 'ok' | 'down' | 'slow') {
    this.mode = mode
  }

  get size() {
    return this.records.length
  }

  get failures() {
    return this.failedWrites
  }

  get all(): readonly AnalyticsEvent[] {
    return this.records
  }

  clear() {
    this.records = []
    this.failedWrites = 0
  }

  async put(events: AnalyticsEvent[]): Promise<void> {
    if (this.mode === 'slow') await new Promise((r) => setTimeout(r, 1500))
    if (this.mode === 'down') {
      this.failedWrites += events.length
      throw new Error('stream unavailable')
    }
    this.records.push(...events)
  }
}
