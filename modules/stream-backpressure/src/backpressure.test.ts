import { describe, it, expect, beforeAll } from 'vitest'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { ensureCsv } from './csv.js'
import { runLoad } from './load.js'
import { FailingSink, lineSplitter, rowParser } from './sink.js'

/**
 * 힙 숫자는 여기서 안 본다. vitest는 `--expose-gc` 없이 도니까
 * 아직 안 치운 쓰레기까지 세어서 세 방식이 다 비슷하게 나온다.
 * 대신 버퍼에 쌓인 건수와 스트림이 닫혔는지를 본다. 둘 다 GC와 무관하다.
 */
const ROWS = 50000
const BATCH = 100
let path: string

beforeAll(async () => {
  path = (await ensureCsv(ROWS)).path
}, 120_000)

describe('반환값을 안 보면 버퍼에 쌓인다', () => {
  it('쌓인 양이 highWaterMark를 훌쩍 넘는다', async () => {
    const r = await runLoad('ignore', { path, batch: BATCH, highWaterMark: 1000 })
    expect(r.rows).toBe(ROWS)
    expect(r.peakQueued).toBeGreaterThan(10_000)
  }, 120_000)

  it('drain을 기다리면 highWaterMark 근처에 머문다', async () => {
    const r = await runLoad('drain', { path, batch: BATCH, highWaterMark: 1000 })
    expect(r.rows).toBe(ROWS)
    expect(r.peakQueued).toBeLessThan(1000)
  }, 120_000)

  it('pipeline()도 highWaterMark 근처에 머문다', async () => {
    const r = await runLoad('pipeline', { path, batch: BATCH, highWaterMark: 1000 })
    expect(r.rows).toBe(ROWS)
    expect(r.peakQueued).toBeLessThan(1000)
  }, 120_000)
})

describe('쌓이는 양을 정하는 것', () => {
  it('뒤가 한 번에 더 많이 삼키면 덜 쌓인다', async () => {
    const slow = await runLoad('ignore', { path, batch: 100 })
    const fast = await runLoad('ignore', { path, batch: 4000 })
    expect(fast.peakQueued).toBeLessThan(slow.peakQueued)
  }, 120_000)

  it('highWaterMark를 올리면 pipeline()도 그만큼 받아준다', async () => {
    const tight = await runLoad('pipeline', { path, batch: BATCH, highWaterMark: 1000 })
    const loose = await runLoad('pipeline', { path, batch: BATCH, highWaterMark: 50000 })
    expect(loose.peakQueued).toBeGreaterThan(tight.peakQueued)
  }, 120_000)
})

describe('뒤가 터졌을 때', () => {
  it('pipe()는 앞을 안 닫는다', async () => {
    const src = createReadStream(path, { highWaterMark: 64 * 1024 })
    const split = lineSplitter()
    const dest = new FailingSink(500)
    src.pipe(split).pipe(rowParser()).pipe(dest)
    await new Promise<void>((r) => dest.once('error', () => r()))

    expect(src.destroyed).toBe(false)
    expect(split.destroyed).toBe(false)
    src.destroy()
    split.destroy()
  }, 60_000)

  it('pipeline()은 앞뒤를 같이 닫고 에러를 한 군데로 올린다', async () => {
    const src = createReadStream(path, { highWaterMark: 64 * 1024 })
    const split = lineSplitter()
    await expect(
      pipeline(src, split, rowParser(), new FailingSink(500)),
    ).rejects.toThrow('적재처가 끊겼습니다')

    expect(src.destroyed).toBe(true)
    expect(split.destroyed).toBe(true)
  }, 60_000)
})
