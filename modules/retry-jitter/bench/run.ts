import { stampede, line, type Reading } from '../src/herd.js'
import { RealClock } from '../src/clock.js'
import {
  fixed,
  exponential,
  exponentialNudged,
  equalJitter,
  fullJitter,
  decorrelated,
  type Policy,
} from '../src/policies.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0
const CLIENTS = Number(process.env.CLIENTS ?? 1000)
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 8)
const BASE = Number(process.env.BASE ?? 100)
const QUEUE = Number(process.env.QUEUE ?? 50)
const SERVICE = Number(process.env.SERVICE ?? 5)
const SEED = Number(process.env.SEED ?? 1)

const backoff = { baseMs: BASE, capMs: 10_000 }
const server = { serviceMs: SERVICE, workers: 1, queueLimit: QUEUE }

const policies: Policy[] = [
  fixed(1000),
  exponential(backoff),
  exponentialNudged(backoff, 0.1),
  equalJitter(backoff),
  fullJitter(backoff),
  decorrelated(backoff),
]

console.log(`\n서버는 요청 하나에 ${SERVICE}ms, 초당 ${Math.round(1000 / SERVICE)}건을 처리합니다.`)
console.log(`줄은 ${QUEUE}개까지 세우고 넘치면 바로 거절합니다.`)
console.log(`클라이언트는 첫 시도를 합쳐 ${ATTEMPTS}번까지 해보고 포기합니다. 첫 대기는 ${BASE}ms입니다.\n`)

if (ONLY === 0 || ONLY === 1) await scenarioSameInstant()
if (ONLY === 0 || ONLY === 2) await scenarioScattered()
if (ONLY === 0 || ONLY === 3) await scenarioHowMany()
if (ONLY === 0 || ONLY === 4) await scenarioLongQueue()
if (ONLY === 0 || ONLY === 5) await scenarioRealTimers()

/**
 * 1. 전원이 같은 순간에 실패했을 때.
 */
async function scenarioSameInstant() {
  console.log(`[1] ${CLIENTS}개가 같은 순간에 보냈을 때\n`)

  const readings: Reading[] = []
  for (const policy of policies) {
    const r = await stampede({ clients: CLIENTS, policy, maxAttempts: ATTEMPTS, server, seed: SEED })
    console.log(line(r))
    readings.push(r)
  }

  const bare = readings[1]
  console.log(`\n    지터 없는 지수는 서버가 ${(bare.utilization * 100).toFixed(0)}%만 일했는데 ${bare.gaveUp}개가 포기했습니다.`)
  console.log(`    서버가 못 받은 게 아니라, 받을 수 있을 때 아무도 안 왔습니다.`)

  console.log(`\n    지터가 들어간 줄은 씨앗에 따라 움직입니다. 씨앗 다섯 개로 다시 돌린 포기 수`)
  for (const policy of policies.slice(2)) {
    const gaveUps: number[] = []
    for (let seed = 1; seed <= 5; seed++) {
      const r = await stampede({ clients: CLIENTS, policy, maxAttempts: ATTEMPTS, server, seed })
      gaveUps.push(r.gaveUp)
    }
    console.log(`      ${policy.name.padEnd(12)} ${gaveUps.join(' / ')}`)
  }
}

/**
 * 2. 실패한 시각이 흩어져 있었다면.
 */
async function scenarioScattered() {
  const n = Math.round(CLIENTS * 0.6)
  const down = { ...server, downUntilMs: 3000 }
  console.log(`\n[2] 서버가 3초 죽어 있었고 그동안 ${n}개가 왔을 때\n`)

  console.log(`    3초에 걸쳐 흩어져서 왔다`)
  for (const policy of policies) {
    console.log(line(await stampede({ clients: n, policy, maxAttempts: ATTEMPTS, server: down, spreadMs: 3000, seed: SEED })))
  }

  console.log(`\n    같은 순간에 왔다`)
  for (const policy of policies) {
    console.log(line(await stampede({ clients: n, policy, maxAttempts: ATTEMPTS, server: down, seed: SEED })))
  }

  console.log(`\n    흩어져서 실패한 쪽은 지터가 없어도 안 몰립니다. 몰리게 하는 건 재시도가 아니라 같은 출발 시각입니다.`)
  console.log(`    그리고 전부 흔드는 쪽이 오히려 포기가 나옵니다. 평균 대기가 절반이라 ${ATTEMPTS}번을 더 빨리 씁니다.`)
}

/**
 * 3. 몇 개부터 차이가 나는가.
 */
async function scenarioHowMany() {
  console.log(`\n[3] 클라이언트 수를 바꿔가며 (지수 대 지수 + 전체 지터)\n`)

  for (const n of [50, 100, 200, 500, 1000, 5000]) {
    for (const policy of [exponential(backoff), fullJitter(backoff)]) {
      const r = await stampede({
        label: `${n}개 · ${policy.name === '지수' ? '지터 없음' : '전체 지터'}`,
        clients: n,
        policy,
        maxAttempts: ATTEMPTS,
        server,
        seed: SEED,
      })
      console.log(line(r, 18))
    }
  }

  console.log(`\n    지터 없는 쪽의 성공 수는 500개든 5000개든 같습니다. 물결 하나가 줄 길이만큼만 들어가기 때문입니다.`)
  console.log(`    5000개에서는 지터를 넣어도 절반 넘게 포기합니다. 지터는 용량을 만들어주지 않습니다.`)
}

/**
 * 4. 줄을 늘리면 되지 않나.
 */
async function scenarioLongQueue() {
  console.log(`\n[4] 줄을 ${QUEUE}개에서 1000개로 늘리면\n`)

  const cases: Array<[string, number, number | undefined]> = [
    [`줄 ${QUEUE}`, QUEUE, undefined],
    ['줄 1000', 1000, undefined],
    ['줄 1000 · 1초 타임아웃', 1000, 1000],
  ]

  for (const [label, queueLimit, timeoutMs] of cases) {
    for (const policy of [exponential(backoff), fullJitter(backoff)]) {
      const r = await stampede({
        label: `${label} · ${policy.name === '지수' ? '지터 없음' : '전체 지터'}`,
        clients: CLIENTS,
        policy,
        maxAttempts: ATTEMPTS,
        server: { ...server, queueLimit },
        timeoutMs,
        seed: SEED,
      })
      console.log(line(r, 28) + `  헛일 ${String(r.wasted).padStart(5)}  성공까지 p50 ${(r.p50 / 1000).toFixed(1)}초`)
    }
  }

  console.log(`\n    헛일은 서버가 처리했는데 클라이언트가 이미 떠난 요청입니다.`)
  console.log(`    줄이 길고 클라이언트가 먼저 포기하면, 서버는 계속 바쁜데 받는 사람이 없습니다. 지터로는 못 풉니다.`)
}

/**
 * 5. 가상 시계가 거짓말을 하지 않는가.
 */
async function scenarioRealTimers() {
  console.log(`\n[5] 같은 코드를 진짜 setTimeout 위에서 (20초쯤 걸립니다)\n`)

  for (const policy of [exponential(backoff), fullJitter(backoff)]) {
    const virtual = await stampede({ label: `가상 · ${policy.name}`, clients: CLIENTS, policy, maxAttempts: ATTEMPTS, server, seed: SEED })
    const real = await stampede({ label: `진짜 · ${policy.name}`, clients: CLIENTS, policy, maxAttempts: ATTEMPTS, server, seed: SEED, clock: new RealClock() })
    console.log(line(virtual, 18))
    console.log(line(real, 18))
  }

  console.log(`\n    진짜 시계에서는 타이머가 제 시각에 딱 깨지 않아서 숫자가 조금 다릅니다. 모양은 같아야 합니다.`)
}
