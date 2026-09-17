import { createS3, ensureBucket, listObjects } from '../../event-storage-layout/src/store.js'
import { openEngine as seedEngine } from '../../event-storage-layout/src/scan.js'
import { seedLayouts, TARGET_DAY } from '../../event-storage-layout/src/layout.js'
import { openEngine, batchSql, timed } from '../src/engine.js'
import { measure, line } from '../src/measure.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0
const PER_DAY = Number(process.env.PER_DAY ?? 200000)
const WINDOW = Number(process.env.WINDOW ?? 6000)
const BATCH_THREADS = Number(process.env.BATCH_THREADS ?? 1)

const s3 = createS3()
await ensureBucket(s3)

console.log(`\n하루 ${PER_DAY.toLocaleString()}건으로 쌓습니다.`)
const seeder = await seedEngine()
await seedLayouts(s3, seeder, PER_DAY)
const stored = (await listObjects(s3, 'parquet-part/')).reduce((s, o) => s + o.size, 0)
console.log(`저장소에 ${(stored / 1024 / 1024).toFixed(1)}MB\n`)

if (ONLY === 0 || ONLY === 1) await scenarioShareOrSplit()
if (ONLY === 0 || ONLY === 2) await scenarioLimitBatch()
if (ONLY === 0 || ONLY === 3) await scenarioOneCopy()

/**
 * 1. 배치와 조회를 같은 자원에 두면 어떻게 되는가.
 */
async function scenarioShareOrSplit() {
  console.log(`[1] 같은 자원에 둘 것인가, 나눌 것인가\n`)

  const solo = await openEngine()
  const base = await measure('배치가 안 돌 때', null, solo, TARGET_DAY, WINDOW)
  console.log(line(base))

  // 같은 인스턴스에 연결만 둘. 스레드 풀을 나눠 쓴다.
  const shared = await openEngine()
  const sharedAsk = shared
  const sameEngine = await measure('한 자원에서 같이', shared, sharedAsk, TARGET_DAY, WINDOW)
  console.log(line(sameEngine, base))

  // 인스턴스를 따로. 풀이 갈린다.
  const batchOnly = await openEngine()
  const askOnly = await openEngine()
  const split = await measure('자원을 나눠서', batchOnly, askOnly, TARGET_DAY, WINDOW)
  console.log(line(split, base))

  console.log(`\n    같은 자원에 두면 조회가 배치를 기다립니다.`)
  console.log(`    나누면 배치가 도는 줄 모르고 조회가 끝납니다.`)
}

/**
 * 2. 나눈 뒤에도 같은 기계를 쓴다면.
 */
async function scenarioLimitBatch() {
  console.log(`\n[2] 나눈 뒤에도 기계는 하나일 때\n`)

  const solo = await openEngine()
  const base = await measure('배치가 안 돌 때', null, solo, TARGET_DAY, WINDOW)
  console.log(line(base))

  const greedy = await openEngine()
  const ask1 = await openEngine()
  const unlimited = await measure('배치가 스레드를 다 씀', greedy, ask1, TARGET_DAY, WINDOW)
  console.log(line(unlimited, base))

  const capped = await openEngine(BATCH_THREADS)
  const ask2 = await openEngine()
  const limited = await measure(
    `배치를 ${BATCH_THREADS}스레드로 묶음`, capped, ask2, TARGET_DAY, WINDOW,
  )
  console.log(line(limited, base))

  console.log(`\n    자원을 나눠도 기계가 하나면 완전히 갈라지지는 않습니다.`)
  console.log(`    배치가 쓸 수 있는 몫을 정해두면 조회 쪽이 보장됩니다.`)
  console.log(`    대신 배치가 ${(unlimited.batchRuns / Math.max(1, limited.batchRuns)).toFixed(1)}배 덜 돕니다. 공짜가 아닙니다.`)
}

/**
 * 3. 나눠도 데이터는 한 벌인가.
 */
async function scenarioOneCopy() {
  console.log(`\n[3] 데이터는 한 벌인가\n`)

  const a = await openEngine()
  const b = await openEngine()

  const ra = await a.runAndReadAll(batchSql())
  const rb = await b.runAndReadAll(batchSql())
  const same = JSON.stringify(ra.getRows().map(String)) === JSON.stringify(rb.getRows().map(String))

  const ta = await timed(a, batchSql())
  const tb = await timed(b, batchSql())

  console.log(`    자원 둘이 같은 답을 내나  ${same ? '예' : '아니오'}`)
  console.log(`    각각 걸린 시간           ${ta.toFixed(0)}ms / ${tb.toFixed(0)}ms`)

  const files = await listObjects(s3, 'parquet-part/')
  console.log(`    저장소에 있는 파일        ${files.length}개 (${(stored / 1024 / 1024).toFixed(1)}MB)`)
  console.log(`\n    자원을 둘로 나눠도 파일은 그대로 ${files.length}개입니다.`)
  console.log(`    복사본을 만들었으면 어느 쪽이 맞는지 다투게 됩니다.`)
}
