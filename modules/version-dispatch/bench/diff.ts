/**
 * 모든 조합에서 두 구현을 비교한다.
 *
 * 분기가 흩어진 코드는 조합이 늘어날수록 의도와 어긋나는 지점이 생긴다.
 * 요구사항을 표로 옮긴 뒤 전수 비교하면 그 지점이 드러난다.
 */
import { supportsNaive } from '../src/naive.js'
import { supports } from '../src/capabilities.js'
import type { Channel, Client, Feature, Platform } from '../src/types.js'

const PLATFORMS: Platform[] = ['ios', 'android', 'web']
const CHANNELS: Channel[] = ['production', 'beta', 'internal']
const FEATURES: Feature[] = [
  'biometricLogin', 'inAppPurchase', 'pushRichMedia', 'darkMode', 'offlineCart',
]
const VERSIONS = [
  '2.8.0', '2.9.0', '3.0.0', '3.2.0', '3.4.0', '3.5.0',
  '3.8.0', '4.0.0', '4.7.0', '5.0.0',
]

const diffs: {
  feature: Feature; platform: Platform; channel: Channel
  version: string; naive: boolean; table: boolean
}[] = []

let total = 0
for (const feature of FEATURES) {
  for (const platform of PLATFORMS) {
    for (const channel of CHANNELS) {
      for (const version of VERSIONS) {
        total += 1
        const client: Client = { platform, appVersion: version, channel }
        const a = supportsNaive(client, feature)
        const b = supports(client, feature)
        if (a !== b) {
          diffs.push({ feature, platform, channel, version, naive: a, table: b })
        }
      }
    }
  }
}

console.log(`조합 ${total}개 중 ${diffs.length}개가 다르다\n`)

const byFeature = new Map<string, typeof diffs>()
for (const d of diffs) {
  const list = byFeature.get(d.feature) ?? []
  list.push(d)
  byFeature.set(d.feature, list)
}

for (const [feature, list] of byFeature) {
  console.log(`## ${feature} (${list.length}건)`)
  console.table(
    list.map((d) => ({
      플랫폼: d.platform, 채널: d.channel, 버전: d.version,
      '개선 전': d.naive, '표 기준': d.table,
    })),
  )
}
