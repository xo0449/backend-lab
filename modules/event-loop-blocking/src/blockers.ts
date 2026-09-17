import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 정해진 ms 동안 이벤트 루프를 붙잡는다.
 *
 * 비교의 기준자다. 진짜 작업은 크기에 따라 막는 시간이 들쭉날쭉해서
 * "몇 ms부터 보이는가"를 물으려면 시간을 직접 정할 수 있는 막대가 필요하다.
 */
export function busy(ms: number): void {
  const until = performance.now() + ms
  // eslint-disable-next-line no-empty
  while (performance.now() < until) {}
}

const ROW = {
  id: 0,
  userId: 'u-00000000',
  event: 'order_placed',
  ts: '2026-09-18T00:00:00.000Z',
  amount: 12900,
}

/** 대략 bytes 크기의 JSON 문자열을 만든다. 실제 크기는 `.length`로 확인한다. */
export function makeJson(bytes: number): string {
  const one = JSON.stringify(ROW).length + 1
  const rows = Math.max(1, Math.round(bytes / one))
  return JSON.stringify(Array.from({ length: rows }, (_, i) => ({ ...ROW, id: i })))
}

/**
 * 백트래킹이 터지는 정규식. 입력 한 글자가 걸리는 시간을 두 배로 만든다.
 * 크기가 아니라 모양이 시간을 정하는 예다.
 */
export const EVIL = /^(a+)+$/

export function evilInput(n: number): string {
  return 'a'.repeat(n) + '!'
}

let dir: string | null = null

/** 대략 bytes 크기의 파일을 만들고 경로를 준다. 같은 크기는 한 번만 만든다. */
export function makeFile(bytes: number): string {
  dir ??= mkdtempSync(join(tmpdir(), 'loop-block-'))
  const path = join(dir, `${bytes}.json`)
  try {
    readFileSync(path)
  } catch {
    writeFileSync(path, makeJson(bytes))
  }
  return path
}

export function timeOnce(fn: () => unknown): number {
  const t = performance.now()
  fn()
  return performance.now() - t
}

/** 한 번만 재면 GC나 JIT가 섞인다. 여러 번 재고 가운뎃값을 쓴다. */
export function timeMedian(fn: () => unknown, runs = 7): number {
  const xs = Array.from({ length: runs }, () => timeOnce(fn)).sort((a, b) => a - b)
  return xs[Math.floor(xs.length / 2)]
}
