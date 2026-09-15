import type { Client, Feature } from './types.js'

/**
 * 개선 전. 기능마다 switch와 if로 분기한다.
 *
 * 각 분기는 그때그때 요구사항을 받아 하나씩 덧붙인 결과다.
 * 한 번에 보면 이상하지만, 한 줄씩 추가될 때는 아무도 이상하게 여기지 않는다.
 */
export function supportsNaive(client: Client, feature: Feature): boolean {
  const { platform, appVersion, channel } = client
  const [major, minor] = appVersion.split('.').map(Number)

  switch (feature) {
    case 'biometricLogin':
      if (platform === 'ios') {
        if (major > 3) return true
        if (major === 3 && minor >= 2) return true
        return false
      }
      if (platform === 'android') {
        // 안드로이드는 3.5부터. 단 내부 채널은 3.4부터 켰다.
        if (channel === 'internal' && major === 3 && minor >= 4) return true
        if (major > 3) return true
        if (major === 3 && minor >= 5) return true
        return false
      }
      return false

    case 'inAppPurchase':
      if (platform === 'web') return false
      if (major >= 4) return true
      // 4.0 미만이지만 베타 채널에는 미리 열어줬다.
      if (channel === 'beta' && major === 3 && minor >= 8) return true
      return false

    case 'pushRichMedia':
      if (platform === 'ios' && major >= 3) return true
      if (platform === 'android' && major >= 4) return true
      return false

    case 'darkMode':
      if (major > 2) return true
      if (major === 2 && minor >= 9) return true
      return false

    case 'offlineCart':
      if (platform === 'web') return false
      if (channel === 'production') {
        if (major >= 5) return true
        return false
      }
      // 베타와 내부는 4.7부터
      if (major > 4) return true
      if (major === 4 && minor >= 7) return true
      return false

    default:
      return false
  }
}
