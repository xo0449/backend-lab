import { describe, it, expect } from 'vitest'
import { ShortCache } from './cache.js'

describe('ShortCache', () => {
  it('TTL 안에서는 다시 부르지 않는다', async () => {
    const cache = new ShortCache<number>(1000)
    await cache.get(async () => 1)
    await cache.get(async () => 2)
    expect(cache.misses).toBe(1)
  })

  it('동시에 들어온 요청은 진행 중인 작업을 공유한다', async () => {
    const cache = new ShortCache<number>(1000)
    let calls = 0
    const load = async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 50))
      return calls
    }

    const results = await Promise.all([
      cache.get(load), cache.get(load), cache.get(load), cache.get(load),
    ])

    expect(calls).toBe(1)
    expect(results).toEqual([1, 1, 1, 1])
  })

  it('TTL이 지나면 다시 부른다', async () => {
    const cache = new ShortCache<number>(20)
    await cache.get(async () => 1)
    await new Promise((r) => setTimeout(r, 40))
    await cache.get(async () => 2)
    expect(cache.misses).toBe(2)
  })
})
