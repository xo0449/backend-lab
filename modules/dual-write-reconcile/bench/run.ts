import { createS3, ensureBucket } from '../../event-storage-layout/src/store.js'
import { openEngine } from '../../event-storage-layout/src/scan.js'
import { generateDay, kstDate } from '../../event-storage-layout/src/event.js'
import { AnalyticsTool, isFunnel, FUNNEL_EVENTS } from '../src/tool.js'
import { route, resetLake } from '../src/router.js'
import { reconcile, totalMissing, detectionDelay } from '../src/reconcile.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0
const PER_DAY = Number(process.env.PER_DAY ?? 20000)
const BROKEN_MINUTES = Number(process.env.BROKEN_MINUTES ?? 30)

const DAYS = ['2026-09-14', '2026-09-15', '2026-09-16']
const s3 = createS3()
await ensureBucket(s3)
const conn = await openEngine()

if (ONLY === 0 || ONLY === 1) await scenarioWhatToSend()
if (ONLY === 0 || ONLY === 2) await scenarioOneSideBreaks()
if (ONLY === 0 || ONLY === 3) await scenarioReconcile()
if (ONLY === 0 || ONLY === 4) await scenarioResend()

/**
 * 1. 전부 보낼 것인가, 골라 보낼 것인가.
 *
 * 도구는 이벤트 수로 돈을 받는다. 무엇을 보내는지가 곧 요금이다.
 */
async function scenarioWhatToSend() {
  console.log(`\n[1] 도구에 무엇을 보낼 것인가\n`)
  const events = generateDay(DAYS[2], PER_DAY, 7)
  const funnel = events.filter(isFunnel)

  console.log(`    하루에 만들어진 이벤트        ${events.length.toLocaleString()}건`)
  console.log(`    그중 퍼널에 쓰는 것          ${funnel.length.toLocaleString()}건`)
  console.log(`    전부 보내면 도구가 세는 수     ${events.length.toLocaleString()}건`)
  console.log(`    골라 보내면                ${funnel.length.toLocaleString()}건` +
    ` (${(100 - (funnel.length / events.length) * 100).toFixed(0)}% 적음)`)

  const perType = new Map<string, number>()
  for (const e of events) perType.set(e.name, (perType.get(e.name) ?? 0) + 1)
  console.log(`\n    보내는 것: ${FUNNEL_EVENTS.join(', ')}`)
  const skipped = [...perType.keys()].filter((n) => !FUNNEL_EVENTS.includes(n))
  console.log(`    안 보내는 것: ${skipped.join(', ')}`)
  console.log(`\n    안 보내는 것도 저장소에는 그대로 남습니다. 나중에 물을 수 있습니다.`)
}

/**
 * 2. 한쪽만 끊겼을 때 무슨 일이 나는가.
 */
async function scenarioOneSideBreaks() {
  console.log(`\n[2] 도구 쪽만 잠깐 끊겼을 때\n`)
  const tool = new AnalyticsTool()
  await resetLake(s3)

  const events = generateDay(DAYS[2], PER_DAY, 7)
  // 하루를 분 단위 묶음으로 나눠 보낸다. 그중 일부 구간에서 도구가 죽는다.
  const perMinute = Math.max(1, Math.round(events.length / 1440))
  let failed = 0
  for (let m = 0; m < 1440; m++) {
    const batch = events.slice(m * perMinute, (m + 1) * perMinute)
    if (batch.length === 0) break
    tool.setMode(m >= 600 && m < 600 + BROKEN_MINUTES ? 'down' : 'ok')
    const r = await route(s3, tool, batch)
    failed += r.toolFailed
  }

  const funnel = events.filter(isFunnel).length
  console.log(`    저장소에 들어간 것          ${events.length.toLocaleString()}건 (전부)`)
  console.log(`    도구에 들어간 것           ${tool.count.toLocaleString()}건`)
  console.log(`    도구가 받았어야 할 것        ${funnel.toLocaleString()}건`)
  console.log(`    ${BROKEN_MINUTES}분 끊긴 동안 흘린 것      ${failed.toLocaleString()}건`)
  console.log(`\n    저장소는 멀쩡합니다. 도구 화면에도 숫자가 나옵니다.`)
  console.log(`    ${((failed / funnel) * 100).toFixed(1)}% 적은 숫자인데, 보는 사람은 그걸 모릅니다.`)
}

/**
 * 3. 대조하면 알아챈다. 그런데 언제 알아채는가.
 */
async function scenarioReconcile() {
  console.log(`\n[3] 대조 장치\n`)
  const tool = new AnalyticsTool()
  await resetLake(s3)

  const events = generateDay(DAYS[2], PER_DAY, 7)
  const perMinute = Math.max(1, Math.round(events.length / 1440))
  for (let m = 0; m < 1440; m++) {
    const batch = events.slice(m * perMinute, (m + 1) * perMinute)
    if (batch.length === 0) break
    tool.setMode(m >= 600 && m < 600 + BROKEN_MINUTES ? 'down' : 'ok')
    await route(s3, tool, batch)
  }

  const day = kstDate(events[0].received_at)
  const gaps = await reconcile(conn, tool, day)
  console.log(`    ${day} 기준\n`)
  console.log(`      ${'이벤트'.padEnd(16)} ${'저장소'.padStart(8)} ${'도구'.padStart(8)} ${'차이'.padStart(8)}`)
  for (const g of gaps) {
    console.log(
      `      ${g.name.padEnd(16)} ${g.inLake.toLocaleString().padStart(8)}` +
      ` ${g.inTool.toLocaleString().padStart(8)} ${g.missing.toLocaleString().padStart(8)}`,
    )
  }
  console.log(`\n    빠진 것 합계 ${totalMissing(gaps).toLocaleString()}건`)

  console.log(`\n    대조를 얼마나 자주 돌리느냐가 곧 알아채는 시점입니다.`)
  console.log(`\n      ${'주기'.padEnd(10)} ${'최악의 경우 알아채기까지'.padStart(22)} ${'그동안 흘릴 수 있는 양'.padStart(24)}`)
  const lostPerDay = totalMissing(gaps)
  for (const every of [1, 7, 30]) {
    const worst = detectionDelay(0, every)
    console.log(
      `      ${(every + '일에 한 번').padEnd(10)} ${(worst + '일').padStart(22)}` +
      ` ${(lostPerDay * worst).toLocaleString().padStart(24)}건`,
    )
  }
  console.log(`\n    대조를 안 돌리면 영원히 모릅니다.`)
}

/**
 * 4. 빠진 것을 다시 보낼 때.
 */
async function scenarioResend() {
  console.log(`\n[4] 빠진 것을 다시 보낼 때\n`)
  const events = generateDay(DAYS[2], 2000, 7).filter(isFunnel)

  for (const dedupe of [false, true]) {
    const tool = new AnalyticsTool(dedupe)
    await tool.send(events)
    const before = tool.count
    // 어디까지 들어갔는지 모르니 그날 것을 통째로 다시 보낸다.
    await tool.send(events)
    const label = dedupe ? '멱등 열쇠를 같이 보냄' : '그냥 다시 보냄     '
    console.log(
      `    ${label}  처음 ${before.toLocaleString()}건` +
      ` → 다시 보낸 뒤 ${tool.count.toLocaleString()}건` +
      ` ${tool.count === before ? '(그대로)' : '(두 배)'}`,
    )
  }
  console.log(`\n    열쇠가 없으면 재전송이 그대로 중복이 됩니다.`)
  console.log(`    그러면 빠진 걸 알아도 다시 보낼 수가 없습니다.`)
}
