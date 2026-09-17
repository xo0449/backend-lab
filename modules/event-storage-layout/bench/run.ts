import { createS3, ensureBucket, listObjects } from '../src/store.js'
import { openEngine, best, scannedBytesText, scannedBytesColumnar, size } from '../src/scan.js'
import {
  seedLayouts, QUERY, PREFIX, COLUMNS, TARGET_DAY, TARGET_NAME, DAYS,
} from '../src/layout.js'
import {
  seedSmallFiles, querySmallFiles, bytesOf, FILE_COUNTS,
} from '../src/smallfiles.js'
import {
  seedSchemaChange, renameQuery, retypeQuery, truthQuery, tryQuery,
} from '../src/schema.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0
const PER_DAY = Number(process.env.PER_DAY ?? 50000)

const s3 = createS3()
await ensureBucket(s3)
const conn = await openEngine()

console.log(`\n하루 ${PER_DAY.toLocaleString()}건 x ${DAYS.length}일을 쌓습니다.`)
const t0 = performance.now()
await seedLayouts(s3, conn, PER_DAY)
console.log(`적재 ${Math.round(performance.now() - t0)}ms\n`)

if (ONLY === 0 || ONLY === 1) await scenarioFormatAndPartition()
if (ONLY === 0 || ONLY === 2) await scenarioSmallFiles()
if (ONLY === 0 || ONLY === 3) await scenarioSchemaChange()

/**
 * 1. 같은 질문을 네 레이아웃에 던진다.
 *
 * 질문: "9월 16일(KST)에 결제 화면을 몇 번 봤나"
 * 답은 넷 다 같아야 한다. 다르면 레이아웃이 아니라 데이터가 틀린 것이다.
 */
async function scenarioFormatAndPartition() {
  console.log('[1] 형식과 파티션')
  console.log(`    질문: ${TARGET_DAY} KST 하루의 ${TARGET_NAME} 건수\n`)

  const bytes = {
    jsonFlat: await scannedBytesText(s3, [PREFIX.jsonFlat]),
    jsonPart: await scannedBytesText(s3, [`${PREFIX.jsonPart}dt=${TARGET_DAY}/`]),
    parquetFlat: await scannedBytesColumnar(
      conn, `${PREFIX.parquetFlat}*.parquet`, [...COLUMNS.parquetFlat],
    ),
    parquetPart: await scannedBytesColumnar(
      conn, `${PREFIX.parquetPart}dt=${TARGET_DAY}/*.parquet`, [...COLUMNS.parquetPart],
    ),
  }

  const labels: Record<keyof typeof QUERY, string> = {
    jsonFlat: 'JSON · 한 폴더',
    jsonPart: 'JSON · 날짜 폴더',
    parquetFlat: 'Parquet · 한 폴더',
    parquetPart: 'Parquet · 날짜 폴더',
  }

  const head = bytes.jsonFlat
  for (const key of Object.keys(QUERY) as (keyof typeof QUERY)[]) {
    const r = await best(conn, QUERY[key])
    const cut = head === 0 ? 0 : (1 - bytes[key] / head) * 100
    console.log(
      `    ${labels[key].padEnd(20)} ${String(r.rows).padStart(6)}건` +
      ` ${String(r.ms).padStart(5)}ms  읽은 양 ${size(bytes[key]).padStart(8)}` +
      ` (${cut.toFixed(2)}% 덜 읽음)`,
    )
  }

  const raw = (await listObjects(s3, PREFIX.jsonFlat)).reduce((s, o) => s + o.size, 0)
  const cur = (await listObjects(s3, PREFIX.parquetFlat)).reduce((s, o) => s + o.size, 0)
  console.log(`\n    원본 전체 ${size(raw)} · 정제본 전체 ${size(cur)}\n`)
}

/**
 * 2. 같은 하루치를 파일 개수만 바꿔 읽는다.
 *
 * 내용이 같으므로 답도 같다. 달라지는 건 여는 횟수다.
 */
async function scenarioSmallFiles() {
  console.log('[2] 같은 데이터, 파일 개수만 다르게')
  const dayIndex = DAYS.indexOf(TARGET_DAY)
  await seedSmallFiles(s3, conn, dayIndex)
  console.log()

  let baseMs = 0
  for (const n of FILE_COUNTS) {
    const r = await best(conn, querySmallFiles(n))
    const bytes = await bytesOf(s3, n)
    if (baseMs === 0) baseMs = r.ms
    const ratio = baseMs === 0 ? 1 : r.ms / baseMs
    console.log(
      `    파일 ${String(n).padStart(3)}개  ${String(r.rows).padStart(6)}건` +
      ` ${String(r.ms).padStart(5)}ms (${ratio.toFixed(1)}배)  차지하는 양 ${size(bytes)}`,
    )
  }
  console.log()
}

/**
 * 3. 어느 날 이벤트 모양이 바뀌면 과거와 같이 읽을 때 무슨 일이 나는가.
 */
async function scenarioSchemaChange() {
  console.log('[3] 이벤트 모양이 바뀐 뒤')
  const oldIndex = DAYS.indexOf('2026-09-15')
  const newIndex = DAYS.indexOf('2026-09-16')
  await seedSchemaChange(s3, conn, oldIndex, newIndex)

  const truth = await tryQuery(conn, truthQuery(oldIndex, newIndex))
  const [trueRows, trueWith, trueAvg, trueTotal] = truth.values ?? [0, 0, 0, 0]
  console.log(`\n    바뀌기 전 원본으로 센 값`)
  console.log(`      전체 ${trueRows.toLocaleString()}건 · 값이 있는 행 ${trueWith.toLocaleString()}건 · 평균 ${trueAvg} · 합계 ${trueTotal.toLocaleString()}`)

  console.log(`\n    필드 이름이 바뀐 경우 (duration_ms → dwell_ms)`)
  for (const byName of [false, true]) {
    const r = await tryQuery(conn, renameQuery(byName))
    const how = byName ? '이름으로 맞춤' : '그냥 읽음    '
    if (!r.ok) {
      console.log(`      ${how}  멈춤: ${r.error?.slice(0, 72)}`)
      continue
    }
    const [rows, withValue, avg] = r.values!
    const lost = rows - withValue
    console.log(
      `      ${how}  ${rows.toLocaleString()}건 읽고 평균은 ${withValue.toLocaleString()}건으로 계산` +
      ` (${lost.toLocaleString()}건이 조용히 빠짐) 평균 ${avg} · 진짜 ${trueAvg}`,
    )
  }

  console.log(`\n    필드 타입이 바뀐 경우 (amount 숫자 → 문자열)`)
  for (const byName of [false, true]) {
    const r = await tryQuery(conn, retypeQuery(byName))
    const how = byName ? '이름으로 맞춤' : '그냥 읽음    '
    if (!r.ok) {
      console.log(`      ${how}  멈춤: ${r.error?.slice(0, 72)}`)
      continue
    }
    const [rows, total] = r.values!
    const same = total === trueTotal ? '진짜 값과 같음' : `진짜 값과 다름 (${trueTotal.toLocaleString()})`
    console.log(`      ${how}  ${rows.toLocaleString()}건 · 합계 ${total.toLocaleString()} · ${same}`)
  }
  console.log()
}
