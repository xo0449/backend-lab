import { Agent, request } from 'node:http'

export interface Reading {
  label: string
  p50: number
  p99: number
  p999: number
  worst: number
  done: number
  blocks: number
  lagP99: number
}

export interface LoadOptions {
  label: string
  port: number
  durationMs: number
  /** 동시에 몇 개를 띄워둘 것인가. 응답이 오면 바로 다음 것을 보낸다 */
  concurrency: number
  /** 재는 동안 주기적으로 이벤트 루프를 막을 작업 */
  block?: { everyMs: number; run: () => void }
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 동시 실행 수를 고정해두고 응답 시간을 잰다.
 *
 * 처음에는 "초당 N건"을 시각표대로 던지는 쪽으로 짰다. 그게 바깥에서
 * 들어오는 트래픽에 더 가깝기 때문이다. 그런데 윈도우에서 `setTimeout`의
 * 눈금이 16ms쯤이라, 아무것도 안 막아도 기준 p99가 26ms로 나왔다.
 * 재려는 신호가 1~10ms인데 자가 16ms면 잴 수 없다.
 *
 * 그래서 타이머로 페이스를 잡지 않는 쪽으로 바꿨다. 이쪽은 막히는 동안
 * 새 요청이 안 들어오므로 실제 트래픽보다 덜 아프게 나온다. 대신 그 대가로
 * 완료 건수가 같이 떨어져서, 두 숫자를 같이 보면 된다.
 */
export async function load(o: LoadOptions): Promise<Reading> {
  const agent = new Agent({ keepAlive: true, maxSockets: o.concurrency })
  const latencies: number[] = []
  let blocks = 0
  let stop = false

  const timer = o.block
    ? setInterval(() => {
        o.block!.run()
        blocks++
      }, o.block.everyMs)
    : null

  const lag = lagMeter()

  const workers = Array.from({ length: o.concurrency }, async () => {
    while (!stop) {
      const t = performance.now()
      await fire(agent, o.port)
      latencies.push(performance.now() - t)
    }
  })

  await sleep(o.durationMs)
  stop = true
  if (timer) clearInterval(timer)
  const lagP99 = percentile(lag.stop(), 99)
  await Promise.all(workers)
  agent.destroy()

  return {
    label: o.label,
    p50: percentile(latencies, 50),
    p99: percentile(latencies, 99),
    p999: percentile(latencies, 99.9),
    worst: latencies.length ? Math.max(...latencies) : 0,
    done: latencies.length,
    blocks,
    lagP99,
  }
}

function fire(agent: Agent, port: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
      res.resume()
      res.on('end', () => resolve())
    })
    req.on('error', () => resolve())
    req.end()
  })
}

/**
 * 타이머가 제 시각보다 얼마나 늦게 깨는지 잰다. 운영에서 알람을 거는 신호다.
 * 이 PC에서는 아무것도 안 막아도 p99가 20ms 넘게 나온다. 윈도우 타이머 눈금이다.
 */
export function lagMeter(everyMs = 20) {
  const samples: number[] = []
  let last = performance.now()
  const t = setInterval(() => {
    const now = performance.now()
    samples.push(Math.max(0, now - last - everyMs))
    last = now
  }, everyMs)
  return {
    stop: () => {
      clearInterval(t)
      return samples
    },
  }
}

export function line(r: Reading, base?: Reading): string {
  const ratio = base && base.p99 > 0 ? `(${(r.p99 / base.p99).toFixed(1)}배)` : ''
  return (
    `    ${r.label.padEnd(22)}` +
    ` p50 ${r.p50.toFixed(2).padStart(6)}ms` +
    `  p99 ${r.p99.toFixed(1).padStart(6)}ms ${ratio.padEnd(9)}` +
    `  p99.9 ${r.p999.toFixed(1).padStart(6)}ms` +
    `  최악 ${r.worst.toFixed(0).padStart(4)}ms` +
    `  완료 ${String(r.done).padStart(6)}건`
  )
}
