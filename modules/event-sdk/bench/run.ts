/**
 * SDK가 호스트 앱을 멈추지 않는지 직접 확인한다.
 * 외부 의존이 없다. Docker 없이 바로 돈다.
 */
import { execSync } from 'node:child_process'
import { statSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createSdk } from '../src/sdk.js'
import type { Transport } from '../src/transport.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function recordingTransport() {
  const sent: any[][] = []
  const transport: Transport = {
    async send(_url, body) {
      sent.push(JSON.parse(body))
      return true
    },
  }
  return { transport, sent }
}

const throwingTransport: Transport = {
  async send() {
    throw new Error('network down')
  },
}

async function main() {
  const results: Record<string, unknown>[] = []

  // 1. 전송이 실패해도 호출자가 멈추지 않는다
  const rejections: unknown[] = []
  const onRejection = (e: unknown) => rejections.push(e)
  process.on('unhandledRejection', onRejection)

  let threw = false
  let nextLineRan = false
  const failing = createSdk({ endpoint: '/e', transport: throwingTransport, maxBatchSize: 1 })
  try {
    failing.track('checkout_clicked')
    nextLineRan = true
  } catch {
    threw = true
  }
  await wait(200)
  process.off('unhandledRejection', onRejection)

  results.push({
    확인: '전송 실패가 호출자에 닿는가',
    'track이 던졌는가': threw,
    '다음 줄이 실행됐는가': nextLineRan,
    '처리되지 않은 거부': rejections.length,
  })

  // 2. 배치 크기에 도달하면 보낸다
  const a = recordingTransport()
  const batched = createSdk({
    endpoint: '/e', transport: a.transport,
    maxBatchSize: 3, flushIntervalMs: 60_000,
  })
  batched.track('a')
  batched.track('b')
  const beforeThird = a.sent.length
  batched.track('c')
  await wait(50)

  results.push({
    확인: '배치 크기 조건',
    '2건 시점 전송': beforeThird,
    '3건 시점 전송': a.sent.length,
    '한 번에 보낸 건수': a.sent[0]?.length ?? 0,
  })

  // 3. 큐가 넘치면 오래된 것부터 버린다
  const b = recordingTransport()
  const capped = createSdk({
    endpoint: '/e', transport: b.transport,
    maxBatchSize: 1000, maxQueueSize: 5, flushIntervalMs: 60_000,
  })
  for (let i = 0; i < 20; i++) capped.track(`e${i}`)
  await capped.flush()

  results.push({
    확인: '큐 상한',
    '넣은 건수': 20,
    '남은 건수': b.sent[0]?.length ?? 0,
    '가장 오래된 이벤트': b.sent[0]?.[0]?.name ?? '-',
  })

  // 4. 번들 크기
  const out = '/tmp/backend-lab-sdk.min.js'
  execSync(
    `npx esbuild modules/event-sdk/src/sdk.ts --bundle --minify --format=esm --outfile=${out} --log-level=error`,
    { stdio: 'inherit' },
  )
  const raw = statSync(out).size
  const gz = gzipSync(readFileSync(out)).length

  results.push({ 확인: '번들 크기', minify: `${raw} bytes`, gzip: `${gz} bytes` })

  for (const r of results) {
    const { 확인, ...rest } = r as any
    console.log(`\n## ${확인}`)
    console.table([rest])
  }
}

main()
