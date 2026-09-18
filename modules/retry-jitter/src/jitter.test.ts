import { describe, it, expect } from 'vitest'
import { RealClock, VirtualClock, rng } from './clock.js'
import { stampede } from './herd.js'
import { peakIn } from './server.js'
import { exponential, equalJitter, fullJitter, decorrelated } from './policies.js'

const backoff = { baseMs: 100, capMs: 10_000 }
const server = { serviceMs: 5, workers: 1, queueLimit: 50 }

describe('정책이 돌려주는 대기 시간', () => {
  it('지수는 두 배씩 늘다가 상한에서 멈춘다', () => {
    const p = exponential(backoff)
    const rand = rng(1)
    expect([1, 2, 3, 4].map((a) => p.next(a, 0, rand))).toEqual([100, 200, 400, 800])
    expect(p.next(20, 0, rand)).toBe(10_000)
  })

  it('전체 지터는 0과 지수 값 사이에, 절반 지터는 절반과 지수 값 사이에 있다', () => {
    const rand = rng(7)
    for (let i = 0; i < 1000; i++) {
      const full = fullJitter(backoff).next(4, 0, rand)
      const half = equalJitter(backoff).next(4, 0, rand)
      expect(full).toBeGreaterThanOrEqual(0)
      expect(full).toBeLessThan(800)
      expect(half).toBeGreaterThanOrEqual(400)
      expect(half).toBeLessThan(800)
    }
  })

  it('직전 값 기준 지터는 첫 재시도부터 흔든다', () => {
    const rand = rng(3)
    const firsts = new Set(Array.from({ length: 50 }, () => decorrelated(backoff).next(1, 0, rand)))
    expect(firsts.size).toBeGreaterThan(40)
    for (const d of firsts) {
      expect(d).toBeGreaterThanOrEqual(100)
      expect(d).toBeLessThan(300)
    }
  })
})

describe('같은 순간에 실패하면', () => {
  it('지터가 없으면 거절당한 전원이 같은 10ms 안에 다시 온다', async () => {
    const r = await stampede({ clients: 1000, policy: exponential(backoff), maxAttempts: 8, server })
    // 첫 물결에서 처리 중 1개와 줄 50개가 들어가고 나머지 949개가 거절당한다
    expect(r.retryPeak).toBe(949)
    expect(r.gaveUp).toBeGreaterThan(500)
    expect(r.utilization).toBeLessThan(0.2)
  })

  it('전체 지터를 넣으면 덜 몰리고 거의 다 성공한다', async () => {
    const r = await stampede({ clients: 1000, policy: fullJitter(backoff), maxAttempts: 8, server })
    expect(r.retryPeak).toBeLessThan(300)
    expect(r.succeeded).toBeGreaterThan(950)
  })

  it('지터가 없으면 성공 수가 클라이언트 수와 상관없다', async () => {
    const a = await stampede({ clients: 500, policy: exponential(backoff), maxAttempts: 8, server })
    const b = await stampede({ clients: 5000, policy: exponential(backoff), maxAttempts: 8, server })
    expect(a.succeeded).toBe(b.succeeded)
  })

  it('줄에 다 들어갈 만큼 적으면 지터가 있든 없든 같다', async () => {
    const a = await stampede({ clients: 50, policy: exponential(backoff), maxAttempts: 8, server })
    const b = await stampede({ clients: 50, policy: fullJitter(backoff), maxAttempts: 8, server })
    expect(a.requests).toBe(50)
    expect(b.requests).toBe(50)
  })
})

describe('흩어져서 실패하면', () => {
  it('지터가 없어도 안 몰리고 아무도 포기하지 않는다', async () => {
    const r = await stampede({
      clients: 600,
      policy: exponential(backoff),
      maxAttempts: 8,
      server: { ...server, downUntilMs: 3000 },
      spreadMs: 3000,
    })
    expect(r.retryPeak).toBeLessThan(50)
    expect(r.gaveUp).toBe(0)
  })
})

describe('줄이 길고 클라이언트가 먼저 포기하면', () => {
  it('타임아웃이 없으면 줄 1000개가 재시도 없이 전부 받아낸다', async () => {
    const r = await stampede({
      clients: 1000,
      policy: exponential(backoff),
      maxAttempts: 8,
      server: { ...server, queueLimit: 1000 },
    })
    expect(r.succeeded).toBe(1000)
    expect(r.requests).toBe(1000)
  })

  it('타임아웃이 있으면 지터를 넣어도 헛일이 성공보다 많다', async () => {
    for (const policy of [exponential(backoff), fullJitter(backoff)]) {
      const r = await stampede({
        clients: 1000,
        policy,
        maxAttempts: 8,
        server: { ...server, queueLimit: 1000 },
        timeoutMs: 1000,
      })
      expect(r.wasted).toBeGreaterThan(r.succeeded)
      expect(r.gaveUp).toBeGreaterThan(300)
    }
  })
})

describe('재는 도구', () => {
  it('같은 씨앗이면 같은 결과가 나온다', async () => {
    const a = await stampede({ clients: 1000, policy: fullJitter(backoff), maxAttempts: 8, server, seed: 42 })
    const b = await stampede({ clients: 1000, policy: fullJitter(backoff), maxAttempts: 8, server, seed: 42 })
    expect(a).toEqual(b)
  })

  it('가상 시계는 같은 시각의 타이머를 예약한 순서대로 깨운다', async () => {
    const clock = new VirtualClock()
    const woke: number[] = []
    clock.after(10, () => woke.push(1))
    clock.after(5, () => woke.push(0))
    clock.after(10, () => woke.push(2))
    await clock.drain()
    expect(woke).toEqual([0, 1, 2])
    expect(clock.now()).toBe(10)
  })

  it('peakIn은 창 하나에 가장 많이 든 수를 센다', () => {
    expect(peakIn([0, 1, 2, 50, 51, 52, 53, 200], 10)).toBe(4)
    expect(peakIn([], 10)).toBe(0)
  })

  it('진짜 시계에서도 같은 모양이 나온다', async () => {
    const o = { clients: 300, policy: exponential(backoff), maxAttempts: 4, server }
    const virtual = await stampede(o)
    const real = await stampede({ ...o, clock: new RealClock() })
    expect(real.retryPeak).toBe(virtual.retryPeak)
    expect(Math.abs(real.succeeded - virtual.succeeded)).toBeLessThan(20)
  }, 20_000)
})
