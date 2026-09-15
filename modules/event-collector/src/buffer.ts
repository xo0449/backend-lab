import type { StoredEvent } from './event.js'

export interface BufferOptions {
  maxEvents?: number
  maxAgeMs?: number
}

/**
 * 이벤트를 모아 두었다가 한 번에 내보낸다.
 *
 * 끊는 조건이 두 가지다.
 * - 크기만 쓰면 트래픽이 적을 때 이벤트가 영원히 나가지 않는다.
 * - 시간만 쓰면 몰릴 때 파일 하나가 거대해진다.
 * 그래서 둘 중 먼저 오는 쪽으로 끊는다.
 *
 * push는 동기다. 이벤트를 보낸 쪽을 기다리게 하지 않는다.
 * 대신 진행 중인 쓰기를 들고 있다가 flush에서 기다린다.
 * 이게 없으면 "flush를 기다렸는데 아직 안 써졌다"가 생긴다.
 */
export class EventBuffer {
  private events: StoredEvent[] = []
  private timer?: NodeJS.Timeout
  private pending = new Set<Promise<void>>()
  private readonly maxEvents: number
  private readonly maxAgeMs: number

  constructor(
    private readonly sink: (batch: StoredEvent[]) => Promise<void>,
    options: BufferOptions = {},
  ) {
    this.maxEvents = options.maxEvents ?? 1000
    this.maxAgeMs = options.maxAgeMs ?? 10_000
  }

  get size() {
    return this.events.length
  }

  push(events: StoredEvent[]): void {
    if (events.length === 0) return
    this.events.push(...events)

    if (this.events.length >= this.maxEvents) {
      this.drain()
      return
    }
    this.timer ??= setTimeout(() => this.drain(), this.maxAgeMs)
  }

  /** 버퍼를 비우고 쓰기를 시작한다. 완료를 기다리지 않는다. */
  private drain(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.events.length === 0) return

    // 먼저 비운다. 쓰는 동안 들어온 이벤트가 이 배치에 섞이지 않는다.
    const batch = this.events
    this.events = []

    const task = this.sink(batch).finally(() => {
      this.pending.delete(task)
    })
    this.pending.add(task)
  }

  /** 버퍼를 비우고, 진행 중인 쓰기까지 모두 끝나면 반환한다. */
  async flush(): Promise<void> {
    this.drain()
    while (this.pending.size > 0) {
      await Promise.all([...this.pending])
    }
  }
}
