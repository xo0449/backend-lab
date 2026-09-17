import { createReadStream } from 'node:fs'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { parseLine } from './csv.js'
import { memWatcher, type Run } from './memory.js'
import { lineSplitter, rowParser, SlowSink, type SinkOptions } from './sink.js'

export type Mode = 'ignore' | 'drain' | 'pipeline'

export interface LoadOptions extends SinkOptions {
  path: string
  label?: string
  /** 파일에서 한 번에 읽어오는 바이트 */
  readHwm?: number
}

/**
 * 세 가지로 같은 파일을 같은 적재처에 넣는다.
 *
 * - `ignore`   `write()`의 반환값을 안 본다. 리뷰에서 제일 자주 보는 모양이다
 * - `drain`    반환값이 false면 `drain`을 기다린다. 손으로 거는 backpressure다
 * - `pipeline` 스트림을 이어붙이고 노드에 맡긴다
 */
export async function runLoad(mode: Mode, o: LoadOptions): Promise<Run> {
  const watcher = memWatcher()
  const every = o.sampleEvery ?? 20000
  const sink = new SlowSink({ ...o, sampleEvery: every, onSample: watcher.sample })
  const t0 = performance.now()

  if (mode === 'pipeline') {
    await pipeline(
      createReadStream(o.path, { highWaterMark: o.readHwm ?? 64 * 1024 }),
      lineSplitter(),
      rowParser((n) => { if (n % every === 0) watcher.sample() }),
      sink,
    )
  } else {
    const input = createReadStream(o.path, { highWaterMark: o.readHwm ?? 64 * 1024 })
    const rl = createInterface({ input, crlfDelay: Infinity })
    let produced = 0
    for await (const raw of rl) {
      const row = parseLine(raw)
      if (!row) continue
      const ok = sink.write(row)
      // 이 한 줄이 있고 없고가 이 모듈의 전부다.
      if (!ok && mode === 'drain') await once(sink, 'drain')
      if (++produced % every === 0) watcher.sample()
    }
    sink.end()
    await once(sink, 'finish')
  }

  const wall = performance.now() - t0
  const peak = watcher.stop()
  // 재느라 쓴 시간은 뺀다. 안 빼면 힙이 큰 쪽이 느린 것처럼 보인다.
  const ms = wall - watcher.overhead()
  return {
    label: o.label ?? mode,
    rows: sink.received,
    peakHeap: peak.heapUsed,
    peakRss: peak.rss,
    peakQueued: sink.peakQueued,
    ms,
  }
}
