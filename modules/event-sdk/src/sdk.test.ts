import { describe, it, expect, vi } from 'vitest'
import { createSdk } from './sdk.js'
import type { Transport } from './transport.js'

function fakeTransport() {
  const sent: any[][] = []
  const transport: Transport = {
    async send(_url, body) {
      sent.push(JSON.parse(body))
      return true
    },
    sendSync(_url, body) {
      sent.push(JSON.parse(body))
      return true
    },
  }
  return { transport, sent }
}

const failing: Transport = {
  async send() {
    throw new Error('network down')
  },
}

describe('호스트 앱 보호', () => {
  it('전송이 실패해도 track이 던지지 않는다', () => {
    const sdk = createSdk({ endpoint: '/e', transport: failing, maxBatchSize: 1 })
    expect(() => sdk.track('clicked')).not.toThrow()
  })

  it('전송이 실패해도 flush가 던지지 않는다', async () => {
    const sdk = createSdk({ endpoint: '/e', transport: failing, maxBatchSize: 100 })
    sdk.track('clicked')
    await expect(sdk.flush()).resolves.toBeUndefined()
  })

  it('서버 환경에서 document 없이도 동작한다', () => {
    expect(typeof document).toBe('undefined')
    const { transport, sent } = fakeTransport()
    const sdk = createSdk({ endpoint: '/e', transport, maxBatchSize: 1 })
    sdk.track('server_side')
    expect(sent).toHaveLength(1)
  })
})

describe('배치', () => {
  it('배치 크기에 도달하면 보낸다', async () => {
    const { transport, sent } = fakeTransport()
    const sdk = createSdk({ endpoint: '/e', transport, maxBatchSize: 3, flushIntervalMs: 60_000 })

    sdk.track('a')
    sdk.track('b')
    expect(sent).toHaveLength(0)

    sdk.track('c')
    await new Promise((r) => setTimeout(r, 10))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(3)
  })

  it('시간이 지나면 보낸다', async () => {
    vi.useFakeTimers()
    const { transport, sent } = fakeTransport()
    const sdk = createSdk({ endpoint: '/e', transport, maxBatchSize: 100, flushIntervalMs: 50 })

    sdk.track('a')
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60)
    expect(sent).toHaveLength(1)
    vi.useRealTimers()
  })

  it('flush를 부르면 즉시 보낸다', async () => {
    const { transport, sent } = fakeTransport()
    const sdk = createSdk({ endpoint: '/e', transport, maxBatchSize: 100 })
    sdk.track('a')
    await sdk.flush()
    expect(sent).toHaveLength(1)
  })
})

describe('안전장치', () => {
  it('enabled가 false면 아무것도 보내지 않는다', async () => {
    const { transport, sent } = fakeTransport()
    const sdk = createSdk({ endpoint: '/e', transport, enabled: false, maxBatchSize: 1 })
    sdk.track('a')
    await sdk.flush()
    expect(sent).toHaveLength(0)
  })

  it('큐가 넘치면 오래된 것부터 버린다', async () => {
    const { transport, sent } = fakeTransport()
    const sdk = createSdk({
      endpoint: '/e', transport,
      maxBatchSize: 1000, maxQueueSize: 5, flushIntervalMs: 60_000,
    })

    for (let i = 0; i < 20; i++) sdk.track(`e${i}`)
    await sdk.flush()

    expect(sent[0]).toHaveLength(5)
    expect(sent[0][0].name).toBe('e15')
  })
})

describe('비동기 실패가 새어 나가지 않는다', () => {
  it('전송이 거부해도 처리되지 않은 거부가 생기지 않는다', async () => {
    const rejections: unknown[] = []
    const onRejection = (e: unknown) => rejections.push(e)
    process.on('unhandledRejection', onRejection)

    const sdk = createSdk({ endpoint: '/e', transport: failing, maxBatchSize: 1 })
    sdk.track('boom')
    await new Promise((r) => setTimeout(r, 50))

    process.off('unhandledRejection', onRejection)
    expect(rejections).toHaveLength(0)
  })
})
