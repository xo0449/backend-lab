import { VirtualClock, rng, type Clock } from './clock.js'
import { Server, peakIn, type ServerOptions, type Job } from './server.js'
import type { Policy } from './policies.js'

export interface HerdOptions {
  label?: string
  clients: number
  policy: Policy
  /** 첫 시도를 포함한 횟수. 다 쓰면 포기한다 */
  maxAttempts: number
  server: ServerOptions
  /**
   * 첫 시도가 흩어진 폭. 0이면 전원이 같은 순간에 보낸다.
   * 서버가 재시작하며 물려 있던 연결을 한꺼번에 끊은 상황이 0이다.
   */
  spreadMs?: number
  /** 이 시간 안에 응답이 없으면 클라이언트가 실패로 치고 재시도한다 */
  timeoutMs?: number
  seed?: number
  clock?: Clock
}

export interface Reading {
  label: string
  succeeded: number
  gaveUp: number
  /** 서버에 도착한 요청 수. 첫 시도와 재시도를 합친 값이다 */
  requests: number
  rejected: number
  wasted: number
  /** 10ms 창 하나에 가장 많이 몰린 재시도 수. 서버가 죽어 있던 동안은 뺀다 */
  retryPeak: number
  /** 마지막 클라이언트가 성공하거나 포기한 시각 */
  settledAt: number
  /** 성공한 클라이언트가 첫 시도부터 성공까지 걸린 시간 */
  p50: number
  p99: number
  /** settledAt까지 서버가 일한 시간의 비율 */
  utilization: number
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

export async function stampede(o: HerdOptions): Promise<Reading> {
  const clock = o.clock ?? new VirtualClock()
  const rand = rng(o.seed ?? 1)
  const server = new Server(clock, o.server)
  const spread = o.spreadMs ?? 0

  const took: number[] = []
  let gaveUp = 0
  let settledAt = 0
  /** 서버가 살아 있을 때 도착한 재시도의 시각. 첫 시도는 정책과 무관해서 뺀다 */
  const retryArrivals: number[] = []
  const upFrom = o.server.downUntilMs ?? 0

  for (let i = 0; i < o.clients; i++) {
    const startAt = spread ? rand() * spread : 0
    let attempt = 0
    let prev = 0

    const send = () => {
      attempt++
      if (attempt > 1 && clock.now() >= upFrom) retryArrivals.push(clock.now())
      let settled = false
      const job: Job = {
        abandoned: false,
        done: (ok) => {
          if (settled) return
          settled = true
          ok ? succeed() : fail()
        },
      }
      if (o.timeoutMs) {
        clock.after(o.timeoutMs, () => {
          if (settled) return
          settled = true
          job.abandoned = true
          fail()
        })
      }
      server.request(job)
    }

    const succeed = () => {
      took.push(clock.now() - startAt)
      settledAt = Math.max(settledAt, clock.now())
    }

    const fail = () => {
      if (attempt >= o.maxAttempts) {
        gaveUp++
        settledAt = Math.max(settledAt, clock.now())
        return
      }
      prev = o.policy.next(attempt, prev, rand)
      clock.after(prev, send)
    }

    clock.after(startAt, send)
  }

  await clock.drain()

  return {
    label: o.label ?? o.policy.name,
    succeeded: took.length,
    gaveUp,
    requests: server.arrivals.length,
    rejected: server.rejected,
    wasted: server.wasted,
    retryPeak: peakIn(retryArrivals, 10),
    settledAt,
    p50: percentile(took, 50),
    p99: percentile(took, 99),
    utilization: settledAt ? Math.min(1, server.busyMs / (settledAt * o.server.workers)) : 0,
  }
}

export function line(r: Reading, labelWidth = 14): string {
  return (
    `    ${r.label.padEnd(labelWidth)}` +
    ` 성공 ${String(r.succeeded).padStart(5)}` +
    `  포기 ${String(r.gaveUp).padStart(5)}` +
    `  서버가 받은 요청 ${String(r.requests).padStart(6)}` +
    `  10ms 최대 ${String(r.retryPeak).padStart(5)}` +
    `  끝 ${(r.settledAt / 1000).toFixed(1).padStart(5)}초` +
    `  서버 가동 ${(r.utilization * 100).toFixed(0).padStart(3)}%`
  )
}
