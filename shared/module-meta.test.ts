import { describe, it, expect } from 'vitest'
import { assertValidMeta, type ModuleMeta } from './module-meta'

const base: ModuleMeta = {
  slug: 'x',
  type: 'experiment',
  title: 't',
  summary: 's',
  tags: [],
  question: '왜?',
  createdAt: '2026-09-20',
  metrics: [{ label: '중복 행', before: '발생', after: '0' }],
}

describe('assertValidMeta', () => {
  it('question이 비면 거부한다', () => {
    expect(() => assertValidMeta({ ...base, question: '  ' })).toThrow('question')
  })

  it('실험 모듈에 metrics가 없으면 거부한다', () => {
    expect(() => assertValidMeta({ ...base, metrics: [] })).toThrow('metrics')
  })

  it('구현 모듈에 decisions가 없으면 거부한다', () => {
    const build = { ...base, type: 'build' as const, metrics: undefined }
    expect(() => assertValidMeta(build)).toThrow('decisions')
  })

  it('올바른 메타는 통과한다', () => {
    expect(() => assertValidMeta(base)).not.toThrow()
  })
})
