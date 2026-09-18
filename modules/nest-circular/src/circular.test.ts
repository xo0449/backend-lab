import { describe, it, expect, beforeAll } from 'vitest'
import { build, run, blamed, mentionsCycle, blamesImportType } from './harness.js'

// 케이스마다 자식 프로세스를 띄운다. 빌드는 한 번만 한다
beforeAll(() => build(), 120_000)

describe('어디서 어떤 말로 깨지는가', () => {
  it('순환이 없으면 뜬다', () => {
    expect(run('01-no-cycle')).toEqual({ stage: 'ok', result: 'a sees b' })
  })

  it('프로바이더 순환은 부팅에서 죽고, 메시지는 순환이 아니라 import type을 의심하라고 한다', () => {
    const o = run('02-provider-cycle')
    expect(o.stage).toBe('boot')
    expect(mentionsCycle(o)).toBe(false)
    expect(blamesImportType(o)).toBe(true)
  })

  it('읽는 순서를 바꾸면 에러가 이름을 대는 클래스가 바뀐다', () => {
    expect(blamed(run('02-provider-cycle'))).toBe('BService')
    expect(blamed(run('02-provider-cycle', { first: 'b.service' }))).toBe('AService')
  })

  it('한 파일에 두면 Nest까지 가지도 못하고 import에서 죽는다', () => {
    const o = run('03-provider-cycle-same-file')
    expect(o.stage).toBe('import')
    expect(o.message).toContain('before initialization')
  })

  it('DI에 순환이 없어도 배럴로 import하면 프로바이더 순환과 같은 메시지로 죽는다', () => {
    const barrel = run('04-barrel-no-di-cycle')
    const cycle = run('02-provider-cycle', { first: 'b.service' })
    expect(barrel.stage).toBe('boot')
    expect(barrel.message).toBe(cycle.message)
  })

  it('모듈 순환은 메시지가 순환을 짚어준다', () => {
    const o = run('05-module-cycle')
    expect(o.stage).toBe('boot')
    expect(mentionsCycle(o)).toBe(true)
  })
})

describe('forwardRef', () => {
  it('한쪽에만 붙이면 읽는 순서에 따라 갈린다', () => {
    expect(run('06-forwardref-one-side').stage).toBe('boot')
    expect(run('06-forwardref-one-side', { first: 'b.service' }).stage).toBe('ok')
  })

  it('양쪽에 붙이면 어느 순서로 읽어도 뜬다', () => {
    expect(run('07-forwardref-both').stage).toBe('ok')
    expect(run('07-forwardref-both', { first: 'b.service' }).stage).toBe('ok')
    expect(run('08-module-cycle-forwardref').stage).toBe('ok')
  })

  it('생성자에서 상대의 메서드는 불린다', () => {
    expect(run('09-forwardref-method-in-constructor').stage).toBe('ok')
  })

  it('생성자에서 상대의 필드를 읽으면 한쪽은 에러 없이 undefined를 본다', () => {
    const r = run('10-forwardref-field-in-constructor').result as Record<string, unknown>
    expect(r['A 생성자에서 본 b.limit']).toBe('undefined')
    expect(r['B 생성자에서 본 a.limit']).toBe(100)
    // 부팅이 끝나면 채워져 있다. 그래서 나중에 확인하면 안 보인다
    expect(r['부팅이 끝난 뒤 a.b.limit']).toBe(100)
  })

  it('어느 쪽이 undefined를 보는지는 providers 배열의 순서가 정한다', () => {
    const r = run('11-forwardref-field-providers-swapped').result as Record<string, unknown>
    expect(r['A 생성자에서 본 b.limit']).toBe(100)
    expect(r['B 생성자에서 본 a.limit']).toBe('undefined')
  })

  it('#private 필드를 쓰면 부팅이 끝난 뒤에도 던진다. 순환 밖의 서비스는 멀쩡하다', () => {
    const o = run('15-forwardref-private-field')
    const r = o.result as Record<string, unknown>
    expect(o.stage).toBe('ok')
    expect(r['순환 밖의 c.limit()']).toBe(100)
    expect(String(r['a.limit()'])).toContain('Cannot read private member')
    expect(String(r['b.limit()'])).toContain('Cannot read private member')
  })
})

describe('forwardRef 말고', () => {
  it('ModuleRef는 읽는 순서에 따라 갈린다. 파일 순환이 남아 있어서다', () => {
    expect(run('12-alt-moduleref').stage).toBe('boot')
    expect(run('12-alt-moduleref', { first: 'b.service' }).stage).toBe('ok')
  })

  it('이벤트로 끊거나 셋째로 빼면 어느 순서로 읽어도 뜬다', () => {
    for (const name of ['13-alt-events', '14-alt-extract']) {
      expect(run(name).stage).toBe('ok')
      expect(run(name, { first: 'b.service' }).stage).toBe('ok')
    }
  })
})

describe('tsx로 돌리면', () => {
  it('순환이 없는 케이스와 있는 케이스가 같은 자리에서 같은 말로 죽는다', () => {
    const none = run('01-no-cycle', { runtime: 'tsx' })
    const cycle = run('02-provider-cycle', { runtime: 'tsx' })
    expect(none.stage).toBe('call')
    expect(cycle).toEqual(none)
  })
})
