import { createServer, type Server } from 'node:http'

export type ReceiverMode = 'ok' | 'down' | 'slow'

export interface Receiver {
  server: Server
  received: { orderId: number; eventType: string }[]
  setMode(mode: ReceiverMode): void
  close(): Promise<void>
}

/**
 * 외부 서버 대역. 실패 상황을 만들기 위해 모드를 바꿀 수 있다.
 *
 * - ok: 정상 응답
 * - down: 연결 자체를 끊는다. 서버가 죽은 상황
 * - slow: 3초 뒤 응답한다. 살아 있지만 느린 상황
 */
export async function startReceiver(port = 4801): Promise<Receiver> {
  let mode: ReceiverMode = 'ok'
  const received: { orderId: number; eventType: string }[] = []

  const server = createServer((req, res) => {
    if (mode === 'down') {
      req.socket.destroy()
      return
    }

    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const send = () => {
        try {
          const parsed = JSON.parse(body)
          received.push({ orderId: parsed.orderId, eventType: parsed.eventType })
        } catch {
          // 본문이 깨져도 서버는 죽지 않는다.
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
      }
      if (mode === 'slow') setTimeout(send, 3000)
      else send()
    })
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))

  return {
    server,
    received,
    setMode(next) {
      mode = next
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
