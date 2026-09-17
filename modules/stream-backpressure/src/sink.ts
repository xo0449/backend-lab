import { Transform, Writable } from 'node:stream'
import { parseLine, type Order } from './csv.js'

/**
 * 바쁜 대기로 시간을 쓴다. `setTimeout(1)`은 윈도우에서 16ms쯤 자므로
 * 1~2ms짜리 지연을 흉내낼 수 없다. 앞 모듈(event-loop-blocking)에서 같은 데 걸렸다.
 */
export function spin(ms: number): void {
  if (ms <= 0) return
  const end = performance.now() + ms
  while (performance.now() < end) {
    /* 붙잡고 있는다 */
  }
}

export interface SinkOptions {
  /** 몇 건 모아서 한 번에 넣는가 */
  batch?: number
  /** 배치 한 번에 드는 시간(ms). DB 왕복이라고 보면 된다 */
  msPerBatch?: number
  /** 이 쓰기 스트림이 안에 들고 있어도 되는 객체 수 */
  highWaterMark?: number
  /** 몇 건마다 메모리를 한 번 볼 것인가 */
  sampleEvery?: number
  onSample?: () => void
}

/**
 * 느린 적재처. `_writev`를 일부러 두지 않는다.
 * `_writev`를 두면 노드가 버퍼에 쌓인 것을 한 번에 다 넘겨줘서,
 * 쌓였다는 사실 자체가 측정에서 사라진다.
 */
export class SlowSink extends Writable {
  received = 0
  batches = 0
  /** 버퍼에 가장 많이 쌓였을 때의 객체 수 */
  peakQueued = 0

  private readonly batchSize: number
  private readonly msPerBatch: number
  private readonly sampleEvery: number
  private readonly onSample?: () => void

  constructor(o: SinkOptions = {}) {
    super({ objectMode: true, highWaterMark: o.highWaterMark ?? 1000 })
    this.batchSize = o.batch ?? 1000
    this.msPerBatch = o.msPerBatch ?? 2
    this.sampleEvery = o.sampleEvery ?? 20000
    this.onSample = o.onSample
  }

  override _write(_row: Order, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.received++
    if (this.writableLength > this.peakQueued) this.peakQueued = this.writableLength
    if (this.received % this.sampleEvery === 0) this.onSample?.()

    if (this.received % this.batchSize === 0) {
      this.batches++
      spin(this.msPerBatch)
      // DB 왕복은 다음 틱에 끝난다. 여기서 이벤트 루프를 한 번 돌려줘야
      // 앞쪽이 읽을 틈이 생기고, 그래야 backpressure가 실제로 걸린다.
      setImmediate(cb)
      return
    }
    cb()
  }
}

/** 바이트를 줄로 끊는다. 마지막 조각을 들고 있다가 다음 청크에 붙인다. */
export function lineSplitter(): Transform {
  let tail = ''
  return new Transform({
    readableObjectMode: true,
    transform(chunk: Buffer, _enc, cb) {
      const parts = (tail + chunk.toString('utf8')).split('\n')
      tail = parts.pop() ?? ''
      for (const p of parts) this.push(p.endsWith('\r') ? p.slice(0, -1) : p)
      cb()
    },
    flush(cb) {
      if (tail) this.push(tail.endsWith('\r') ? tail.slice(0, -1) : tail)
      cb()
    },
  })
}

/**
 * `onRow`는 내놓은 건수를 세어 메모리를 재는 자리다. 뒤처짐의 봉우리는 앞쪽이
 * 다 읽은 순간에 생기는데, 그때 적재처는 아직 얼마 못 받았다. 적재처 쪽에서만
 * 재면 봉우리를 지나친 뒤에야 처음 재게 된다.
 */
export function rowParser(onRow?: (n: number) => void): Transform {
  let n = 0
  return new Transform({
    objectMode: true,
    transform(line: string, _enc, cb) {
      const row = parseLine(line)
      if (row) {
        this.push(row)
        onRow?.(++n)
      }
      cb()
    },
  })
}

/** 중간에 한 번 터지는 적재처. pipe와 pipeline의 차이를 보려고 쓴다. */
export class FailingSink extends Writable {
  received = 0
  constructor(private readonly failAfter: number) {
    super({ objectMode: true, highWaterMark: 16 })
  }
  override _write(_row: unknown, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.received++
    if (this.received === this.failAfter) {
      setImmediate(() => cb(new Error('적재처가 끊겼습니다')))
      return
    }
    cb()
  }
}
