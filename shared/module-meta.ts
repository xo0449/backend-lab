export type ModuleType = 'experiment' | 'build'

export interface Metric {
  label: string
  before: string
  after: string
}

export interface Decision {
  question: string
  choice: string
  why: string
}

export interface ModuleMeta {
  slug: string
  type: ModuleType
  title: string
  summary: string
  tags: string[]
  /** 이 모듈에서 고민한 것. 모든 모듈에 필수. */
  question: string
  /** type이 'experiment'일 때 채운다 */
  metrics?: Metric[]
  /** type이 'build'일 때 채운다 */
  decisions?: Decision[]
  createdAt: string
}

/**
 * "모든 모듈은 고민을 기록한다"는 규칙을 코드로 강제한다.
 * 문서에만 적어둔 규칙은 지켜지지 않는다.
 */
export function assertValidMeta(meta: ModuleMeta): void {
  if (!meta.question?.trim()) {
    throw new Error(`[${meta.slug}] question은 비울 수 없습니다`)
  }
  if (meta.type === 'experiment' && !meta.metrics?.length) {
    throw new Error(`[${meta.slug}] 실험 모듈에는 metrics가 필요합니다`)
  }
  if (meta.type === 'build' && !meta.decisions?.length) {
    throw new Error(`[${meta.slug}] 구현 모듈에는 decisions가 필요합니다`)
  }
}
