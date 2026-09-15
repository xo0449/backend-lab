import type { Channel, Client, Feature, Platform } from './types.js'
import { Version } from './version.js'

/**
 * 기능이 열리는 조건을 데이터로 적는다.
 *
 * `since`는 플랫폼별 최소 버전이다. 적히지 않은 플랫폼은 지원하지 않는다.
 * `earlyAccess`는 선행 채널이 먼저 받을 때의 최소 버전이다.
 *
 * 규칙을 코드가 아니라 표로 두면 두 가지가 달라진다.
 * - 새 플랫폼이나 기능을 더할 때 고치는 곳이 이 표 한 곳이다
 * - 정책 전체를 한눈에 볼 수 있어 빠진 조합이 눈에 띈다
 */
export interface Capability {
  since: Partial<Record<Platform, string>>
  earlyAccess?: {
    channels: Channel[]
    since: Partial<Record<Platform, string>>
  }
}

export const CAPABILITIES: Record<Feature, Capability> = {
  biometricLogin: {
    since: { ios: '3.2.0', android: '3.5.0' },
    earlyAccess: {
      channels: ['beta', 'internal'],
      since: { ios: '3.2.0', android: '3.4.0' },
    },
  },
  inAppPurchase: {
    since: { ios: '4.0.0', android: '4.0.0' },
    earlyAccess: {
      channels: ['beta', 'internal'],
      since: { ios: '3.8.0', android: '3.8.0' },
    },
  },
  pushRichMedia: {
    since: { ios: '3.0.0', android: '4.0.0' },
  },
  darkMode: {
    since: { ios: '2.9.0', android: '2.9.0', web: '2.9.0' },
  },
  offlineCart: {
    since: { ios: '5.0.0', android: '5.0.0' },
    earlyAccess: {
      channels: ['beta', 'internal'],
      since: { ios: '4.7.0', android: '4.7.0' },
    },
  },
}

export function supports(client: Client, feature: Feature): boolean {
  const capability = CAPABILITIES[feature]
  if (!capability) return false

  const version = Version.parse(client.appVersion)

  const early = capability.earlyAccess
  if (early?.channels.includes(client.channel)) {
    const min = early.since[client.platform]
    if (min && version.gte(Version.parse(min))) return true
  }

  const min = capability.since[client.platform]
  return min ? version.gte(Version.parse(min)) : false
}
