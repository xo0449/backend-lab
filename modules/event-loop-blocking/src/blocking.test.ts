import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { startServer } from './server.js'
import { load } from './measure.js'
import { busy, makeJson, makeFile, EVIL, evilInput, timeMedian } from './blockers.js'

const WINDOW = 2000
const CONC = 8

describe('막는 시간은 잴 수 있다', () => {
  it('busy(20)은 20ms쯤 붙잡는다', () => {
    const ms = timeMedian(() => busy(20), 3)
    expect(ms).toBeGreaterThanOrEqual(19)
    expect(ms).toBeLessThan(40)
  })

  it('23바이트 정규식 입력이 1MB JSON.parse보다 오래 막는다', () => {
    const json = makeJson(1024 * 1024)
    const input = evilInput(22)
    const parse = timeMedian(() => JSON.parse(json), 3)
    const regex = timeMedian(() => EVIL.test(input), 3)
    expect(regex).toBeGreaterThan(parse)
  })

  it('1MB readFileSync는 1MB JSON.parse보다 덜 막는다', () => {
    const json = makeJson(1024 * 1024)
    const path = makeFile(1024 * 1024)
    readFileSync(path) // 페이지 캐시에 올려두고 잰다
    const parse = timeMedian(() => JSON.parse(json), 3)
    const read = timeMedian(() => readFileSync(path), 3)
    expect(read).toBeLessThan(parse)
  })
})

describe('막으면 꼬리가 밀린다', () => {
  it('50ms씩 막으면 p99.9가 막은 길이만큼 올라간다', async () => {
    const server = await startServer()
    try {
      const base = await load({
        label: '기준', port: server.port, durationMs: WINDOW, concurrency: CONC,
      })
      const blocked = await load({
        label: '막음',
        port: server.port,
        durationMs: WINDOW,
        concurrency: CONC,
        block: { everyMs: 200, run: () => busy(50) },
      })

      expect(blocked.p999).toBeGreaterThan(30)
      expect(blocked.p999).toBeGreaterThan(base.p999)
      // 가운뎃값은 멀쩡하다. 이게 이 모듈의 요지다.
      expect(blocked.p50).toBeLessThan(5)
    } finally {
      await server.close()
    }
  }, 60_000)

  it('안 막으면 꼬리가 조용하다', async () => {
    const server = await startServer()
    try {
      const base = await load({
        label: '기준', port: server.port, durationMs: WINDOW, concurrency: CONC,
      })
      expect(base.p50).toBeLessThan(5)
      expect(base.p999).toBeLessThan(30)
      expect(base.done).toBeGreaterThan(1000)
    } finally {
      await server.close()
    }
  }, 60_000)
})
