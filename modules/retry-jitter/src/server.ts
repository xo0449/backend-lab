import type { Clock } from './clock.js'

export interface ServerOptions {
  /** 요청 하나를 처리하는 데 걸리는 시간 */
  serviceMs: number
  /** 동시에 처리하는 수 */
  workers: number
  /** 기다리게 둘 수 있는 수. 넘으면 바로 거절한다 */
  queueLimit: number
  /** 이 시각까지는 죽어 있다. 오는 것을 전부 거절한다 */
  downUntilMs?: number
}

export interface Job {
  /** 클라이언트가 기다리다 포기했으면 true. 서버는 이걸 모르고 처리한다 */
  abandoned: boolean
  done: (ok: boolean) => void
}

/**
 * 받을 수 있는 양이 정해진 서버.
 *
 * 자리가 있으면 바로 처리하고, 없으면 줄을 세우고, 줄이 다 차면 거절한다.
 * 거절은 공짜로 둔다. 실제로는 거절에도 CPU가 들지만, 여기서 보려는 것은
 * "서버가 받을 수 있었는데 못 받은 양"이라 서버에 유리하게 잡았다.
 */
export class Server {
  private busy = 0
  private queue: Job[] = []

  /** 요청이 도착한 시각. 순간 최대를 셀 때 쓴다 */
  readonly arrivals: number[] = []
  rejected = 0
  served = 0
  /** 처리는 했는데 받을 사람이 이미 떠난 요청 */
  wasted = 0
  busyMs = 0

  constructor(
    private readonly clock: Clock,
    private readonly o: ServerOptions,
  ) {}

  request(job: Job): void {
    this.arrivals.push(this.clock.now())
    if (this.clock.now() < (this.o.downUntilMs ?? 0)) {
      this.rejected++
      job.done(false)
      return
    }
    if (this.busy < this.o.workers) return this.start(job)
    if (this.queue.length < this.o.queueLimit) {
      this.queue.push(job)
      return
    }
    this.rejected++
    job.done(false)
  }

  private start(job: Job): void {
    this.busy++
    this.clock.after(this.o.serviceMs, () => {
      this.busy--
      this.busyMs += this.o.serviceMs
      if (job.abandoned) this.wasted++
      else {
        this.served++
        job.done(true)
      }
      const next = this.queue.shift()
      if (next) this.start(next)
    })
  }
}

/** 길이 windowMs인 창 하나에 가장 많이 들어온 요청 수 */
export function peakIn(arrivals: number[], windowMs: number): number {
  const s = [...arrivals].sort((a, b) => a - b)
  let peak = 0
  let lo = 0
  for (let hi = 0; hi < s.length; hi++) {
    while (s[hi] - s[lo] >= windowMs) lo++
    peak = Math.max(peak, hi - lo + 1)
  }
  return peak
}
