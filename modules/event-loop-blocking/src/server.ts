import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Handle {
  port: number
  served: () => number
  close: () => Promise<void>
}

/**
 * 할 일이 거의 없는 서버. 느려진다면 핸들러 때문이 아니라
 * 이벤트 루프를 막는 다른 무언가 때문이다.
 *
 * `inHandler`를 주면 요청마다 그 작업을 동기로 돌린다.
 */
export async function startServer(inHandler?: () => void): Promise<Handle> {
  let served = 0
  const server = createServer((_req, res) => {
    served++
    inHandler?.()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  server.keepAliveTimeout = 60_000
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    served: () => served,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
