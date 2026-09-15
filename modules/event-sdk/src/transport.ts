export interface Transport {
  /** 실패하면 false. 던지지 않는다. */
  send(url: string, body: string): Promise<boolean>
  /** 페이지를 떠날 때처럼 기다릴 수 없는 상황에서 쓴다. */
  sendSync?(url: string, body: string): boolean
}

/**
 * 환경 감지를 SDK 본체에 숨기지 않고 어댑터로 분리한다.
 * 테스트에서 가짜 전송을 끼워 넣을 수 있고, 새 환경이 생겨도
 * 본체를 건드리지 않는다.
 */
export const fetchTransport: Transport = {
  async send(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      })
      return res.ok
    } catch {
      return false
    }
  },
}

export const browserTransport: Transport = {
  ...fetchTransport,
  sendSync(url, body) {
    try {
      const blob = new Blob([body], { type: 'application/json' })
      return navigator.sendBeacon(url, blob)
    } catch {
      return false
    }
  },
}

export function defaultTransport(): Transport {
  const hasBeacon =
    typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
  return hasBeacon ? browserTransport : fetchTransport
}
