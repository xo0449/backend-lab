import { createS3, ensureBucket } from '../../event-storage-layout/src/store.js'
import { openEngine, best, scannedBytesColumnar, size } from '../../event-storage-layout/src/scan.js'
import { seedLayouts, DAYS } from '../../event-storage-layout/src/layout.js'
import { FORMS, PROJECTIONS, TARGET_DAY, explain, countSql, boundarySql } from '../src/query.js'
import { buildSummary, summarySql, summaryBytes, cumulative, crossover } from '../src/summary.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0
const PER_DAY = Number(process.env.PER_DAY ?? 50000)
const ASKS = Number(process.env.ASKS ?? 30)

const s3 = createS3()
await ensureBucket(s3)
const conn = await openEngine()

console.log(`\n앞 모듈과 같은 모양으로 하루 ${PER_DAY.toLocaleString()}건 x ${DAYS.length}일을 쌓습니다.`)
await seedLayouts(s3, conn, PER_DAY)

if (ONLY === 0 || ONLY === 1) await scenarioHowYouAsk()
if (ONLY === 0 || ONLY === 2) await scenarioWhatYouSelect()
if (ONLY === 0 || ONLY === 3) await scenarioAskingAgain()

/**
 * 1. 같은 하루를 일곱 가지 방법으로 물어본다.
 *
 * 몇 개의 파일을 여는지가 갈릴 거라 예상했다.
 * 실제로는 답도 갈렸다. 그쪽이 더 중요한 발견이었다.
 */
async function scenarioHowYouAsk() {
  console.log(`\n[1] 어떻게 묻느냐\n    질문: ${TARGET_DAY} KST 하루의 건수\n`)

  const answers = new Set<number>()
  for (const form of FORMS) {
    const sql = countSql(form.where)
    const plan = await explain(conn, sql)
    const r = await best(conn, sql)
    answers.add(r.rows)
    console.log(
      `    ${form.label.padEnd(26)} ${String(r.rows).padStart(6)}건` +
      ` 파일 ${String(plan.filesRead).padStart(2)}개 ${String(r.ms).padStart(4)}ms`,
    )
  }
  console.log(`\n    파일 1개는 경로로 걸러진 것이고, ${DAYS.length}개는 전부 연 것입니다.`)

  if (answers.size > 1) {
    console.log(`\n    답이 ${answers.size}가지로 갈렸습니다. 경로와 시각이 어긋난 행이 있습니다.`)
    const rows = (await conn.runAndReadAll(boundarySql())).getRows()
    for (const [dt, kst, n] of rows) {
      console.log(`      ${String(dt)} 폴더에 들어있는 KST ${String(kst)} 이벤트 ${Number(n)}건`)
    }
    console.log(`\n    앞뒤로 하루씩 열고 시각으로 거른 값이 실제 하루입니다.`)
  }
}

/**
 * 2. 파일 수가 같아도 무엇을 꺼내느냐로 읽는 양이 갈린다.
 */
async function scenarioWhatYouSelect() {
  console.log(`\n[2] 무엇을 꺼내느냐\n    조건은 같습니다. 경로의 날짜로 하루만 봅니다.\n`)

  const glob = `parquet-part/dt=${TARGET_DAY}/*.parquet`
  let head = 0
  for (const p of PROJECTIONS) {
    const sql = countSql(`dt = DATE '${TARGET_DAY}'`, p.select)
    const plan = await explain(conn, sql)
    const bytes = await scannedBytesColumnar(conn, glob, [...p.columns])
    if (head === 0) head = bytes
    const ratio = bytes === 0 ? 0 : head / bytes
    console.log(
      `    ${p.label.padEnd(12)} 파일 ${plan.filesRead}개  읽은 양 ${size(bytes).padStart(8)}` +
      `  (${ratio.toFixed(0)}배 적음)`,
    )
  }
  console.log(`\n    파일은 셋 다 1개입니다. 읽는 컬럼만 다릅니다.`)
}

/**
 * 3. 같은 질문을 계속 던지면 언제 미리 세어두는 게 싸지는가.
 */
async function scenarioAskingAgain() {
  console.log(`\n[3] 같은 질문을 계속 던지면\n`)

  const glob = `parquet-part/dt=${TARGET_DAY}/*.parquet`
  const direct = await scannedBytesColumnar(conn, glob, ['name'])

  await buildSummary(s3, conn)
  const perSummary = await summaryBytes(s3, conn)
  // 요약본을 만들 때는 전 기간을 한 번 읽는다. 그게 먼저 치르는 값이다.
  const buildCost = await scannedBytesColumnar(
    conn, 'parquet-part/*/*.parquet', ['dt', 'name', 'amount'],
  )

  const check = await best(conn, summarySql(TARGET_DAY, 'checkout_view'))
  console.log(`    요약본에서 읽은 답 ${check.rows}건 (${check.ms}ms)`)
  console.log(`    한 번 물을 때  원본 ${size(direct)}  ·  요약본 ${size(perSummary)}`)
  console.log(`    요약본 만들 때 한 번 ${size(buildCost)}\n`)

  const at = crossover(direct, buildCost, perSummary)
  for (const n of [1, 5, 10, at, ASKS].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)) {
    const d = cumulative(n, direct)
    const s = cumulative(n, perSummary, buildCost)
    const winner = s < d ? '요약본이 쌈' : '원본이 쌈'
    console.log(
      `    ${String(n).padStart(3)}번 물었을 때  원본 ${size(d).padStart(9)}` +
      `  요약본 ${size(s).padStart(9)}  ${winner}`,
    )
  }
  console.log(`\n    ${at}번째 질문부터 미리 세어두는 쪽이 싸집니다.`)
}
