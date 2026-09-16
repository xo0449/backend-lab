import { describe, it, expect } from 'vitest'
import { supports, CAPABILITIES } from './capabilities.js'
import { supportsNaive } from './naive.js'
import { Version } from './version.js'
import type { Channel, Client, Feature, Platform } from './types.js'

const PLATFORMS: Platform[] = ['ios', 'android', 'web']
const CHANNELS: Channel[] = ['production', 'beta', 'internal']
const FEATURES = Object.keys(CAPABILITIES) as Feature[]
const VERSIONS = [
  '2.8.0', '2.9.0', '3.0.0', '3.2.0', '3.4.0', '3.5.0',
  '3.8.0', '4.0.0', '4.7.0', '5.0.0',
]

function everyCombination(): Client[] {
  const out: Client[] = []
  for (const platform of PLATFORMS) {
    for (const channel of CHANNELS) {
      for (const appVersion of VERSIONS) out.push({ platform, appVersion, channel })
    }
  }
  return out
}

describe('Version', () => {
  it('자리별로 비교한다', () => {
    expect(Version.parse('3.10.0').gte(Version.parse('3.9.0'))).toBe(true)
    expect(Version.parse('3.9.0').gte(Version.parse('3.10.0'))).toBe(false)
  })

  it('같은 버전은 gte가 참이다', () => {
    expect(Version.parse('4.0.0').gte(Version.parse('4.0.0'))).toBe(true)
  })

  it('빠진 자리는 0으로 본다', () => {
    expect(Version.parse('4').gte(Version.parse('4.0.0'))).toBe(true)
  })

  it('숫자가 아니면 거부한다', () => {
    expect(() => Version.parse('4.x.0')).toThrow('버전 형식')
  })
})

describe('patch 자리까지 적는 기준', () => {
  it('4.0.1을 기준으로 두면 4.0.0은 막고 4.0.1부터 연다', () => {
    const min = Version.parse('4.0.1')
    expect(Version.parse('4.0.0').gte(min)).toBe(false)
    expect(Version.parse('4.0.1').gte(min)).toBe(true)
    expect(Version.parse('4.0.2').gte(min)).toBe(true)
    expect(Version.parse('4.1.0').gte(min)).toBe(true)
    expect(Version.parse('3.9.9').gte(min)).toBe(false)
  })

  it('개선 전 코드는 patch를 읽지 않아 이 기준을 표현할 수 없다', () => {
    // naive는 major와 minor만 꺼낸다. 4.0.0과 4.0.9가 같은 값이다.
    const at = (appVersion: string): Client =>
      ({ platform: 'ios', appVersion, channel: 'production' })

    expect(supportsNaive(at('4.0.0'), 'inAppPurchase')).toBe(true)
    expect(supportsNaive(at('4.0.9'), 'inAppPurchase')).toBe(true)
    // 4.0.1부터 열고 싶어도 4.0.0을 막을 방법이 없다.
  })
})

describe('선행 채널', () => {
  it('베타와 내부가 같은 시점에 받는다', () => {
    for (const feature of FEATURES) {
      const early = CAPABILITIES[feature].earlyAccess
      if (!early) continue
      expect(early.channels).toContain('beta')
      expect(early.channels).toContain('internal')
    }
  })

  it('선행 채널의 기준이 정식 기준보다 낮거나 같다', () => {
    for (const feature of FEATURES) {
      const { since, earlyAccess } = CAPABILITIES[feature]
      if (!earlyAccess) continue
      for (const [platform, min] of Object.entries(earlyAccess.since)) {
        const normal = since[platform as Platform]
        if (!normal) continue
        expect(Version.parse(normal).gte(Version.parse(min))).toBe(true)
      }
    }
  })
})

describe('지원하지 않는 플랫폼', () => {
  it('표에 없는 플랫폼은 어떤 버전이어도 거짓이다', () => {
    for (const appVersion of VERSIONS) {
      const client: Client = { platform: 'web', appVersion, channel: 'production' }
      expect(supports(client, 'inAppPurchase')).toBe(false)
      expect(supports(client, 'offlineCart')).toBe(false)
    }
  })
})

describe('개선 전 구현과의 차이', () => {
  it('선행 채널을 빠뜨린 조합 3건에서만 다르다', () => {
    const diffs = []
    for (const feature of FEATURES) {
      for (const client of everyCombination()) {
        if (supportsNaive(client, feature) !== supports(client, feature)) {
          diffs.push({ feature, ...client })
        }
      }
    }

    // 차이가 나는 곳은 전부 "선행 채널 중 한쪽만 열어준" 조합이다.
    expect(diffs).toHaveLength(3)
    for (const d of diffs) {
      expect(['beta', 'internal']).toContain(d.channel)
    }
  })
})
