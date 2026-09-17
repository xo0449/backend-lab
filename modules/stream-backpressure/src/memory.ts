export interface Peak {
  rss: number
  heapUsed: number
}

export const canForceGc = typeof (globalThis as { gc?: () => void }).gc === 'function'

/**
 * 살아 있는 객체가 얼마나 되는지 잰다.
 *
 * 처음에는 `process.memoryUsage().heapUsed`를 그냥 찍었다. 그랬더니 세 방식이
 * 전부 74MB로 똑같이 나왔다. V8이 아직 안 치운 쓰레기까지 같이 세기 때문이다.
 * 세 방식 다 같은 수의 객체를 만드는데, 다른 건 그중 몇 개가 아직 **필요한가**다.
 * 그걸 보려면 재기 직전에 치워야 한다. 그래서 `--expose-gc`로 돌린다.
 *
 * 타이머로 주기를 잡지 않는다. 적재처가 일정 건수마다 `sample()`을 직접 부른다.
 * 윈도우 타이머 눈금이 16ms라 봉우리를 놓치고, GC를 그 간격으로 부르면 너무 비싸다.
 */
export function memWatcher() {
  const gc = (globalThis as { gc?: () => void }).gc
  const peak: Peak = { rss: 0, heapUsed: 0 }
  // 재는 값이 클수록 재는 비용도 커진다. 250MB짜리 힙을 억지로 치우는 데
  // 드는 시간을 안 빼면, 메모리를 많이 쓰는 쪽이 느린 것처럼 보인다.
  let overheadMs = 0
  const sample = () => {
    const t = performance.now()
    gc?.()
    const m = process.memoryUsage()
    if (m.rss > peak.rss) peak.rss = m.rss
    if (m.heapUsed > peak.heapUsed) peak.heapUsed = m.heapUsed
    overheadMs += performance.now() - t
  }
  sample()
  return {
    sample,
    overhead: () => overheadMs,
    stop(): Peak {
      sample()
      return peak
    },
  }
}

export const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)}MB`

export interface Run {
  label: string
  rows: number
  peakHeap: number
  peakRss: number
  peakQueued: number
  ms: number
}

export function line(r: Run, base?: Run): string {
  const ratio = base && base.peakHeap > 0 ? `(${(r.peakHeap / base.peakHeap).toFixed(1)}배)` : ''
  return (
    `    ${r.label.padEnd(22)}` +
    ` 살아있는 힙 최대 ${mb(r.peakHeap).padStart(8)} ${ratio.padEnd(8)}` +
    ` 버퍼에 쌓인 최대 ${String(r.peakQueued).padStart(8)}건` +
    ` ${(r.ms / 1000).toFixed(1)}초`
  )
}
