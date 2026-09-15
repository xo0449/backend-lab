import { describe, it, expect } from 'vitest'
import {
  EVENT_DEFS, buildDedupKey, validateEventPolicy, assertCanPublish,
} from './contract.js'

describe('이벤트 계약', () => {
  it('정의가 규칙을 지킨다', () => {
    expect(() => validateEventPolicy()).not.toThrow()
  })

  it('이벤트마다 큐가 다르다', () => {
    const queues = Object.values(EVENT_DEFS).map((d) => d.queue)
    expect(new Set(queues).size).toBe(queues.length)
  })

  it('소비 앱은 하나다', () => {
    for (const def of Object.values(EVENT_DEFS)) {
      expect(typeof def.consumer).toBe('string')
    }
  })

  it('권한 없는 앱의 발행을 막는다', () => {
    expect(() => assertCanPublish('order-api', 'OrderPlaced')).not.toThrow()
    expect(() => assertCanPublish('job', 'OrderPlaced')).toThrow('발행 권한')
  })
})

describe('dedupKey', () => {
  it('같은 사실은 같은 키가 된다', () => {
    expect(buildDedupKey('OrderPlaced', 42)).toBe(buildDedupKey('OrderPlaced', 42))
  })

  it('구분자가 값에 섞여도 키가 겹치지 않는다', () => {
    // 이스케이프가 없으면 둘 다 'E:a:b'가 되어 하나가 사라진다.
    const a = buildDedupKey('E', 'a:b')
    const b = buildDedupKey('E', 'a', 'b')
    expect(a).not.toBe(b)
  })

  it('너무 길면 조립 시점에 거부한다', () => {
    expect(() => buildDedupKey('E', 'x'.repeat(200))).toThrow('160자')
  })
})
