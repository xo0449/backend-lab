import { readFileSync } from 'node:fs'
import { startServer } from '../src/server.js'
import { load, line, type Reading } from '../src/measure.js'
import { busy, makeJson, makeFile, EVIL, evilInput, timeMedian } from '../src/blockers.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0
const CONC = Number(process.env.CONC ?? 8)
const WINDOW = Number(process.env.WINDOW ?? 6000)
const EVERY = Number(process.env.EVERY ?? 100)
const EVIL_N = Number(process.env.EVIL_N ?? 22)

const server = await startServer()
console.log(`\n127.0.0.1:${server.port} 에 서버를 띄웠습니다.`)
console.log(`동시 ${CONC}개를 띄워두고 ${WINDOW / 1000}초 동안 던집니다.\n`)

if (ONLY === 0 || ONLY === 1) scenarioHowLong()
if (ONLY === 0 || ONLY === 2) await scenarioThreshold()
if (ONLY === 0 || ONLY === 3) await scenarioDutyCycle()
if (ONLY === 0 || ONLY === 4) await scenarioRealWork()

await server.close()

/**
 * 1. 흔한 동기 작업은 실제로 몇 ms 막는가.
 */
function scenarioHowLong() {
  console.log(`[1] 이 작업들은 몇 ms 막는가\n`)

  console.log(`    JSON.parse`)
  for (const kb of [10, 100, 1000, 10000]) {
    const s = makeJson(kb * 1024)
    const ms = timeMedian(() => JSON.parse(s))
    console.log(`      ${fmtSize(s.length).padStart(8)}  ${ms.toFixed(2).padStart(8)}ms`)
  }

  console.log(`\n    readFileSync (같은 파일을 반복해서 읽음)`)
  for (const kb of [10, 100, 1000, 10000]) {
    const path = makeFile(kb * 1024)
    const size = readFileSync(path).length
    const ms = timeMedian(() => readFileSync(path))
    console.log(`      ${fmtSize(size).padStart(8)}  ${ms.toFixed(2).padStart(8)}ms`)
  }

  console.log(`\n    정규식 /^(a+)+$/ · 입력 길이만 바꿈`)
  for (const n of [20, 22, 24, 26, 28]) {
    const input = evilInput(n)
    const ms = timeMedian(() => EVIL.test(input))
    console.log(`      ${String(input.length + 'B').padStart(8)}  ${ms.toFixed(2).padStart(8)}ms`)
  }

  console.log(`\n    크기가 시간을 정하는 것은 앞의 둘뿐입니다.`)
  console.log(`    정규식은 ${EVIL_N + 1}바이트짜리 입력 하나로 그 위의 어떤 줄보다 오래 막습니다.`)
}

/**
 * 2. 몇 ms부터 p99에 보이는가.
 */
async function scenarioThreshold() {
  console.log(`\n[2] 막는 시간이 얼마부터 p99에 보이는가 (${EVERY}ms마다 한 번)\n`)

  const base = await load({ label: '안 막을 때', port: server.port, durationMs: WINDOW, concurrency: CONC })
  console.log(line(base))

  const readings: Reading[] = []
  for (const ms of [1, 2, 5, 10, 20, 50]) {
    const r = await load({
      label: `${ms}ms씩 막음`,
      port: server.port,
      durationMs: WINDOW,
      concurrency: CONC,
      block: { everyMs: EVERY, run: () => busy(ms) },
    })
    console.log(line(r, base))
    readings.push(r)
  }

  const at99 = readings.find((r) => r.p99 > base.p99 * 2)
  const at999 = readings.find((r) => r.p999 > base.p999 * 2)
  console.log(`\n    기준은 p99 ${base.p99.toFixed(1)}ms · p99.9 ${base.p999.toFixed(1)}ms 입니다.`)
  console.log(`    기준의 두 배를 처음 넘는 줄`)
  console.log(`      p99   에서 ${at99 ? at99.label : '없음'}`)
  console.log(`      p99.9 에서 ${at999 ? at999.label : '없음'}`)
  console.log(`\n    한 번 막을 때 다치는 요청은 그때 떠 있던 ${CONC}개뿐입니다.`)
  console.log(`    그 수가 전체의 1%를 못 넘으면 p99는 아무 일도 없었다고 말합니다.`)
}

/**
 * 3. 막는 총량이 같으면 같은가.
 */
async function scenarioDutyCycle() {
  console.log(`\n[3] 막는 총 시간이 같으면 같은가 (전부 시간의 10%)\n`)

  const base = await load({ label: '안 막을 때', port: server.port, durationMs: WINDOW, concurrency: CONC })
  console.log(line(base))

  for (const [ms, every] of [
    [2, 20],
    [10, 100],
    [50, 500],
  ] as const) {
    const r = await load({
      label: `${ms}ms를 ${every}ms마다`,
      port: server.port,
      durationMs: WINDOW,
      concurrency: CONC,
      block: { everyMs: every, run: () => busy(ms) },
    })
    console.log(line(r, base))
  }

  console.log(`\n    세 줄의 CPU 점유는 같습니다. 한 번에 얼마나 붙잡느냐만 다릅니다.`)
}

/**
 * 4. 진짜 작업을 옆에 두면.
 */
async function scenarioRealWork() {
  console.log(`\n[4] 진짜 작업을 ${EVERY}ms마다 옆에서 돌리면\n`)

  const base = await load({ label: '안 막을 때', port: server.port, durationMs: WINDOW, concurrency: CONC })
  console.log(line(base))

  const big = makeJson(1024 * 1024)
  const path = makeFile(1024 * 1024)
  const input = evilInput(EVIL_N)

  const cases: Array<[string, () => void]> = [
    ['JSON.parse 1MB', () => void JSON.parse(big)],
    ['readFileSync 1MB', () => void readFileSync(path)],
    [`정규식 ${input.length}B`, () => void EVIL.test(input)],
  ]

  for (const [label, run] of cases) {
    const r = await load({
      label,
      port: server.port,
      durationMs: WINDOW,
      concurrency: CONC,
      block: { everyMs: EVERY, run },
    })
    console.log(line(r, base))
  }

  console.log(`\n    셋 다 코드로는 한 줄입니다. 리뷰에서 눈에 띄는 모양이 아닙니다.`)
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${Math.round(bytes / 1024)}KB`
}
