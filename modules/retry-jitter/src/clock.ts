/**
 * 시계 두 개. 서버와 클라이언트는 어느 쪽 위에서든 같은 코드로 돈다.
 *
 * 가상 시계는 타이머를 시각 순으로 꺼내 바로 실행한다. 기다리지 않으므로
 * 60초짜리 폭주가 수십 ms에 끝나고, 몇 번을 돌려도 같은 숫자가 나온다.
 * 진짜 시계는 가상 시계가 거짓말을 하지 않는지 대조할 때만 쓴다.
 */
export interface Clock {
  now(): number
  after(ms: number, fn: () => void): void
  /** 예약된 일이 다 끝날 때까지 돌린다 */
  drain(): Promise<void>
}

interface Timer {
  at: number
  seq: number
  fn: () => void
}

export class VirtualClock implements Clock {
  private t = 0
  private seq = 0
  private heap: Timer[] = []

  now(): number {
    return this.t
  }

  after(ms: number, fn: () => void): void {
    this.push({ at: this.t + Math.max(0, ms), seq: this.seq++, fn })
  }

  async drain(): Promise<void> {
    let next: Timer | undefined
    while ((next = this.pop())) {
      this.t = next.at
      next.fn()
    }
  }

  // 같은 시각이면 먼저 예약한 것이 먼저 나온다. setTimeout과 같은 순서다.
  private less(a: Timer, b: Timer): boolean {
    return a.at !== b.at ? a.at < b.at : a.seq < b.seq
  }

  private push(x: Timer): void {
    const h = this.heap
    h.push(x)
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(h[i], h[p])) break
      ;[h[i], h[p]] = [h[p], h[i]]
      i = p
    }
  }

  private pop(): Timer | undefined {
    const h = this.heap
    if (!h.length) return undefined
    const top = h[0]
    const last = h.pop()!
    if (h.length) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < h.length && this.less(h[l], h[m])) m = l
        if (r < h.length && this.less(h[r], h[m])) m = r
        if (m === i) break
        ;[h[i], h[m]] = [h[m], h[i]]
        i = m
      }
    }
    return top
  }
}

export class RealClock implements Clock {
  private readonly t0 = performance.now()
  private pending = 0
  private idle: (() => void) | null = null

  now(): number {
    return performance.now() - this.t0
  }

  after(ms: number, fn: () => void): void {
    this.pending++
    setTimeout(() => {
      fn()
      if (--this.pending === 0) this.idle?.()
    }, ms)
  }

  drain(): Promise<void> {
    if (this.pending === 0) return Promise.resolve()
    return new Promise((resolve) => (this.idle = resolve))
  }
}

/**
 * 씨앗을 받는 난수. Math.random을 쓰면 지터가 들어간 줄의 숫자가
 * 돌릴 때마다 달라져서 README에 적을 수가 없다.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
