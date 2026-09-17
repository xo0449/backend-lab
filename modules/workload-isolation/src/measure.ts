import type { DuckDBConnection } from '@duckdb/node-api'
import { batchSql, interactiveSql, timed, percentile } from './engine.js'

export interface Reading {
  label: string
  p50: number
  p95: number
  worst: number
  runs: number
  batchRuns: number
}

/**
 * 배치를 돌리는 동안 대화형 조회를 계속 던져 지연을 잰다.
 *
 * 배치가 끝날 때까지가 아니라 정해진 시간 동안 잰다.
 * 배치가 느려지면 측정 구간도 같이 늘어나서 비교가 어긋나기 때문이다.
 */
export async function measure(
  label: string,
  batchConn: DuckDBConnection | null,
  askConn: DuckDBConnection,
  day: string,
  ms: number,
): Promise<Reading> {
  const latencies: number[] = []
  let batchRuns = 0
  let stop = false

  const batch = (async () => {
    if (!batchConn) return
    while (!stop) {
      await timed(batchConn, batchSql())
      batchRuns++
    }
  })()

  const asking = (async () => {
    const until = performance.now() + ms
    while (performance.now() < until) {
      latencies.push(await timed(askConn, interactiveSql(day)))
      await new Promise((r) => setTimeout(r, 5))
    }
  })()

  await asking
  stop = true
  await batch

  return {
    label,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    worst: latencies.length ? Math.max(...latencies) : 0,
    runs: latencies.length,
    batchRuns,
  }
}

export function line(r: Reading, base?: Reading): string {
  const ratio = base && base.p95 > 0 ? ` (${(r.p95 / base.p95).toFixed(1)}배)` : ''
  return (
    `    ${r.label.padEnd(30)} p50 ${r.p50.toFixed(0).padStart(5)}ms` +
    `  p95 ${r.p95.toFixed(0).padStart(5)}ms${ratio.padEnd(9)}` +
    `  조회 ${String(r.runs).padStart(4)}회  배치 ${String(r.batchRuns).padStart(3)}회`
  )
}
