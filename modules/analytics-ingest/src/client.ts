import { randomUUID } from 'node:crypto'
import type { AnalyticsEvent, IngestResult } from './event.js'

export interface ClientOptions {
  sourceApp: string
  maxBatchSize?: number
  flushIntervalMs?: number
  maxRetries?: number
  /** 게이트웨이로 보내는 함수. 실패하면 던진다. */
  send: (events: AnalyticsEvent[]) => Promise<IngestResult>
}

/**
 * 브라우저 쪽 수집 클라이언트.
 *
 * 게이트웨이를 거친다. 브라우저에는 스트림 자격증명을 둘 수 없다.
 * 두면 누구나 꺼내서 아무 이벤트나 쓸 수 있다.
 */
export class AnalyticsClient {
  private queue: AnalyticsEvent[] = []
  private timer?: ReturnType<typeof setTimeout>
  private pending = new Set<Promise<void>>()
  private attempts = 0
  private dropped = 0

  constructor(private readonly options: ClientOptions) {}

  get stats() {
    return { attempts: this.attempts, dropped: this.dropped, queued: this.queue.length }
  }

  track(eventType: string, payload: Record<string, unknown> = {}) {
    this.queue.push({
      insertId: randomUUID(),
      eventType,
      sourceApp: this.options.sourceApp,
      producerType: 'client',
      occurredAt: new Date().toISOString(),
      schemaVersion: 2,
      payload,
    })

    if (this.queue.length >= (this.options.maxBatchSize ?? 20)) {
      this.drain()
      return
    }
    this.timer ??= setTimeout(() => this.drain(), this.options.flushIntervalMs ?? 5000)
  }

  private drain() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.queue.length === 0) return

    const batch = this.queue
    this.queue = []
    const task = this.deliver(batch).finally(() => this.pending.delete(task))
    this.pending.add(task)
  }

  /**
   * 실패하면 다시 보낸다. 중복이 생길 수 있지만 유실보다 낫다고 본다.
   * 게이트웨이가 insertId로 거른다는 전제다.
   */
  private async deliver(batch: AnalyticsEvent[]): Promise<void> {
    const max = this.options.maxRetries ?? 3
    for (let i = 0; i <= max; i += 1) {
      this.attempts += 1
      try {
        await this.options.send(batch)
        return
      } catch {
        if (i === max) {
          this.dropped += batch.length
          return
        }
        await new Promise((r) => setTimeout(r, 20 * 2 ** i))
      }
    }
  }

  async flush(): Promise<void> {
    this.drain()
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
  }
}

/**
 * 서버 쪽 프로듀서.
 *
 * 게이트웨이를 거치지 않고 스트림에 직접 쓴다.
 * 이미 신뢰 경계 안이라 검증할 것이 적고, 홉을 하나 줄일 수 있다.
 */
export function createServerProducer(
  sourceApp: string,
  put: (events: AnalyticsEvent[]) => Promise<void>,
) {
  return async function emit(eventType: string, payload: Record<string, unknown> = {}) {
    const now = new Date().toISOString()
    await put([{
      insertId: randomUUID(),
      eventType,
      sourceApp,
      producerType: 'server',
      occurredAt: now,
      receivedAt: now,
      schemaVersion: 2,
      payload,
    }])
  }
}
