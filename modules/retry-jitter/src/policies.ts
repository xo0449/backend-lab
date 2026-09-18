/**
 * 재시도 정책. "몇 번째 실패인가"를 받아 "얼마나 기다릴 것인가"를 돌려준다.
 *
 * attempt는 방금 실패한 시도의 번호다. 첫 시도가 실패했으면 1이다.
 * prev는 직전에 기다린 시간이다. decorrelated만 쓴다.
 */
export interface Policy {
  name: string
  next(attempt: number, prev: number, rand: () => number): number
}

export interface BackoffOptions {
  baseMs: number
  capMs: number
}

const expo = (o: BackoffOptions, attempt: number) =>
  Math.min(o.capMs, o.baseMs * 2 ** (attempt - 1))

/** 늘 같은 시간을 기다린다 */
export function fixed(ms: number): Policy {
  return { name: `고정 ${ms}ms`, next: () => ms }
}

/** 두 배씩 늘린다. 지터 없음 */
export function exponential(o: BackoffOptions): Policy {
  return { name: '지수', next: (attempt) => expo(o, attempt) }
}

/** 두 배씩 늘리고 ±ratio만큼 흔든다. "1초 ± 100ms" 같은 식이다 */
export function exponentialNudged(o: BackoffOptions, ratio: number): Policy {
  return {
    name: `지수 ±${Math.round(ratio * 100)}%`,
    next: (attempt, _prev, rand) => expo(o, attempt) * (1 - ratio + rand() * ratio * 2),
  }
}

/** 절반은 지키고 절반을 흔든다 */
export function equalJitter(o: BackoffOptions): Policy {
  return {
    name: '지수 + 절반 지터',
    next: (attempt, _prev, rand) => {
      const d = expo(o, attempt)
      return d / 2 + rand() * (d / 2)
    },
  }
}

/** 0부터 상한까지 전부 흔든다 */
export function fullJitter(o: BackoffOptions): Policy {
  return { name: '지수 + 전체 지터', next: (attempt, _prev, rand) => rand() * expo(o, attempt) }
}

/** 직전에 기다린 시간의 세 배 안에서 고른다. 시도 횟수를 안 본다 */
export function decorrelated(o: BackoffOptions): Policy {
  return {
    name: '직전 값 기준 지터',
    next: (_attempt, prev, rand) => {
      // 첫 재시도에는 직전 값이 없다. base에서 시작한다
      const hi = (prev || o.baseMs) * 3
      return Math.min(o.capMs, o.baseMs + rand() * (hi - o.baseMs))
    },
  }
}
