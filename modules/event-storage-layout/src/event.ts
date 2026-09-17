/**
 * 적재 실험에 쓰는 이벤트.
 *
 * 실제 수집 이벤트와 모양을 맞춘다. 컬럼 수가 적으면
 * "필요한 컬럼만 읽는다"의 효과가 안 보이기 때문이다.
 */
export interface LabEvent {
  event_id: string
  name: string
  user_id: string
  device: string
  path: string
  referrer: string
  session_id: string
  duration_ms: number
  amount: number
  occurred_at: string
  received_at: string
}

const NAMES = [
  'page_view',
  'item_view',
  'cart_add',
  'checkout_view',
  'purchase',
  'search',
  'banner_click',
]

const DEVICES = ['ios', 'android', 'web']

const PATHS = [
  '/', '/search', '/item/1024', '/item/2048', '/cart',
  '/checkout', '/order/done', '/mypage', '/event/fall',
]

const REFERRERS = [
  'https://www.google.com/', 'https://m.naver.com/', 'direct',
  'https://www.instagram.com/', 'https://kakao.com/',
]

/**
 * 난수를 고정한다. 매번 같은 데이터가 나와야 측정을 비교할 수 있다.
 */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * KST 기준 하루치를 만든다.
 *
 * 저장하는 시각은 UTC ISO 문자열이다. 서비스는 KST로 도는데
 * 시각은 UTC로 남는 실제 상황을 그대로 둔다.
 */
export function generateDay(kstDate: string, count: number, seed: number): LabEvent[] {
  const rnd = makeRandom(seed)
  const dayStartUtc = Date.parse(`${kstDate}T00:00:00+09:00`)
  const out: LabEvent[] = []

  for (let i = 0; i < count; i++) {
    const at = new Date(dayStartUtc + Math.floor(rnd() * 24 * 3600 * 1000))
    const name = NAMES[Math.floor(rnd() * NAMES.length)]
    out.push({
      event_id: `${kstDate}-${i.toString().padStart(7, '0')}`,
      name,
      user_id: `u-${Math.floor(rnd() * 20000)}`,
      device: DEVICES[Math.floor(rnd() * DEVICES.length)],
      path: PATHS[Math.floor(rnd() * PATHS.length)],
      referrer: REFERRERS[Math.floor(rnd() * REFERRERS.length)],
      session_id: `s-${Math.floor(rnd() * 60000)}`,
      duration_ms: Math.floor(rnd() * 30000),
      amount: name === 'purchase' ? Math.floor(rnd() * 200000) : 0,
      occurred_at: at.toISOString(),
      // 수신 시각은 발생보다 조금 늦다. 파티션은 이걸로 자른다.
      received_at: new Date(at.getTime() + Math.floor(rnd() * 3000)).toISOString(),
    })
  }
  return out
}

/**
 * 파티션 키. 수신 시각을 KST로 바꿔 날짜만 남긴다.
 *
 * 관리형 전송 서비스는 기본값이 UTC다. KST로 자르려면
 * 레코드에서 키를 직접 뽑아 써야 한다. 그 자리가 여기다.
 */
export function kstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
