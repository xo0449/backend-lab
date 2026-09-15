import { describe, it, expect } from 'vitest'
import { Workspace, DISCOUNT_V2, DISCOUNT_V3 } from './workspace.js'
import { submodule, packaged, monorepo, copyPaste } from './strategies.js'

const BEFORE = '10000'
const AFTER = '5000'

describe('전파', () => {
  it('모노레포는 커밋 하나로 두 서비스에 반영된다', () => {
    const ws = new Workspace('t-mono')
    try {
      monorepo.setup(ws)
      expect(monorepo.runService(ws, 'service-a')).toBe(BEFORE)

      ws.measure(() => monorepo.propagate(ws, DISCOUNT_V2))

      expect(monorepo.runService(ws, 'service-a')).toBe(AFTER)
      expect(monorepo.runService(ws, 'service-b')).toBe(AFTER)
      // 서비스 쪽에서 할 일이 없다.
      expect(ws.steps.length).toBeLessThan(5)
    } finally {
      ws.cleanup()
    }
  }, 60_000)

  it('서브모듈은 서비스마다 포인터를 옮기는 커밋이 필요하다', () => {
    const ws = new Workspace('t-sub')
    try {
      submodule.setup(ws)
      ws.measure(() => submodule.propagate(ws, DISCOUNT_V2))

      expect(submodule.runService(ws, 'service-a')).toBe(AFTER)
      // 공통 저장소 커밋 + 서비스 두 곳의 pull과 커밋
      expect(ws.steps.length).toBeGreaterThan(5)
    } finally {
      ws.cleanup()
    }
  }, 60_000)
})

describe('고정의 효과', () => {
  it('서브모듈은 공통만 고치면 서비스가 그대로다', () => {
    const ws = new Workspace('t-pin-sub')
    try {
      submodule.setup(ws)
      submodule.changeSharedOnly(ws, DISCOUNT_V2)
      expect(submodule.runService(ws, 'service-a')).toBe(BEFORE)
    } finally {
      ws.cleanup()
    }
  }, 60_000)

  it('패키지도 버전을 올리기 전에는 그대로다', () => {
    const ws = new Workspace('t-pin-pkg')
    try {
      packaged.setup(ws)
      packaged.changeSharedOnly(ws, DISCOUNT_V2)
      expect(packaged.runService(ws, 'service-a')).toBe(BEFORE)
    } finally {
      ws.cleanup()
    }
  }, 120_000)

  it('모노레포는 고정이 없어 공통을 고치면 바로 바뀐다', () => {
    const ws = new Workspace('t-pin-mono')
    try {
      monorepo.setup(ws)
      monorepo.changeSharedOnly(ws, DISCOUNT_V2)
      expect(monorepo.runService(ws, 'service-a')).toBe(AFTER)
    } finally {
      ws.cleanup()
    }
  }, 60_000)
})

describe('버전 스큐', () => {
  it('서브모듈은 한 서비스만 새 버전을 받을 수 있다', () => {
    const ws = new Workspace('t-skew')
    try {
      submodule.setup(ws)
      submodule.changeSharedOnly(ws, DISCOUNT_V2)
      expect(submodule.adoptOne(ws, 'service-a')).toBe(true)

      expect(submodule.runService(ws, 'service-a')).toBe(AFTER)
      expect(submodule.runService(ws, 'service-b')).toBe(BEFORE)
    } finally {
      ws.cleanup()
    }
  }, 60_000)

  it('모노레포는 부분 채택이 불가능하다', () => {
    const ws = new Workspace('t-noskew')
    try {
      monorepo.setup(ws)
      monorepo.changeSharedOnly(ws, DISCOUNT_V2)
      expect(monorepo.adoptOne(ws, 'service-a')).toBe(false)

      // 둘이 같은 소스를 본다. 갈라질 수가 없다.
      expect(monorepo.runService(ws, 'service-a')).toBe(AFTER)
      expect(monorepo.runService(ws, 'service-b')).toBe(AFTER)
    } finally {
      ws.cleanup()
    }
  }, 60_000)
})

describe('호환 깨는 변경', () => {
  it('모노레포는 공통 커밋 즉시 깨진다', () => {
    const ws = new Workspace('t-break-mono')
    try {
      monorepo.setup(ws)
      monorepo.changeSharedOnly(ws, DISCOUNT_V3)
      expect(monorepo.runService(ws, 'service-a')).toBe('NaN')
    } finally {
      ws.cleanup()
    }
  }, 60_000)

  it('서브모듈은 포인터를 옮길 때까지 멀쩡하다', () => {
    const ws = new Workspace('t-break-sub')
    try {
      submodule.setup(ws)
      submodule.changeSharedOnly(ws, DISCOUNT_V3)
      expect(submodule.runService(ws, 'service-a')).toBe(BEFORE)

      // 옮기는 순간 겪는다. 미룬 것이지 피한 것이 아니다.
      submodule.adoptOne(ws, 'service-a')
      expect(submodule.runService(ws, 'service-a')).toBe('NaN')
    } finally {
      ws.cleanup()
    }
  }, 60_000)
})

describe('복사', () => {
  it('공유 장치가 없어 부분 채택이라는 개념이 없다', () => {
    const ws = new Workspace('t-copy')
    try {
      copyPaste.setup(ws)
      expect(copyPaste.adoptOne(ws, 'service-a')).toBe(false)
    } finally {
      ws.cleanup()
    }
  }, 60_000)
})
