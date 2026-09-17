import { createS3, ensureBucket } from '../../event-storage-layout/src/store.js'
import { openEngine } from '../../event-storage-layout/src/scan.js'
import { seedLayouts } from '../../event-storage-layout/src/layout.js'
import {
  createPool, resetSchema, seedOrders, cancelSome, flipTwice, deleteOrder, countByStatus,
} from '../src/orders.js'
import {
  fullDump, incrementalPoll, startChangeReader, writeChanges,
} from '../src/extract.js'
import {
  revenueFromLake, revenueFromDb, repeatPurchaseFromDb, repeatPurchaseFromLake, lightQuery,
  snapshotGlob, changesGlob, percentile, won, type Revenue,
} from '../src/join.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0
const ORDERS = Number(process.env.ORDERS ?? 400000)
const PER_DAY = Number(process.env.PER_DAY ?? 50000)
const DAY = '2026-09-16'

const s3 = createS3()
await ensureBucket(s3)
const conn = await openEngine()
const pool = createPool()

console.log(`\n이벤트 하루 ${PER_DAY.toLocaleString()}건, 주문 ${ORDERS.toLocaleString()}건을 만듭니다.`)
await seedLayouts(s3, conn, PER_DAY)
await resetSchema(pool)
await seedOrders(pool, ORDERS, DAY)

if (ONLY === 0 || ONLY === 1) await scenarioWhatEachSees()
if (ONLY === 0 || ONLY === 2) await scenarioStaleSnapshot()
if (ONLY === 0 || ONLY === 3) await scenarioLoadOnService()

await pool.end()

/**
 * 1. 세 가지 방법이 각각 무엇을 보고 무엇을 놓치는가.
 */
async function scenarioWhatEachSees() {
  console.log(`\n[1] 가져오는 방법마다 무엇이 보이는가\n`)

  const reader = startChangeReader('lab_order')
  await new Promise((r) => setTimeout(r, 400))

  const before = new Date().toISOString().slice(0, 23).replace('T', ' ')
  await new Promise((r) => setTimeout(r, 50))

  // 그 사이에 벌어지는 일 세 가지.
  const canceled = await cancelSome(pool, 0.1)
  await flipTwice(pool, 7)
  await deleteOrder(pool, 11)

  await new Promise((r) => setTimeout(r, 900))
  reader.stop()

  const changes = reader.changes()
  const polled = await incrementalPoll(pool, s3, before, 'a')
  const dumped = await fullDump(pool, s3, 'a')

  console.log(`    그 사이에 실제로 일어난 일`)
  console.log(`      취소 ${canceled.toLocaleString()}건 · 두 번 바뀐 주문 1건 · 지워진 주문 1건\n`)

  console.log(`      ${'방법'.padEnd(18)} ${'가져온 행'.padStart(10)} ${'지워진 걸 아나'.padStart(14)} ${'중간 상태를 보나'.padStart(16)}`)
  console.log(`      ${'야간 전체 덤프'.padEnd(18)} ${dumped.toLocaleString().padStart(10)} ${'없어진 걸로 앎'.padStart(14)} ${'못 봄'.padStart(16)}`)
  console.log(`      ${'updated_at 폴링'.padEnd(18)} ${polled.toLocaleString().padStart(10)} ${'모름'.padStart(14)} ${'못 봄'.padStart(16)}`)
  console.log(`      ${'변경 로그 읽기'.padEnd(18)} ${changes.length.toLocaleString().padStart(10)} ${'지웠다고 알려줌'.padStart(14)} ${'다 봄'.padStart(16)}`)

  const deleted = changes.filter((c) => c.deleted).length
  const order7 = changes.filter((c) => c.order_id === 7).length
  console.log(`\n    변경 로그에는 7번 주문이 ${order7}번 나옵니다. 폴링은 한 번만 가져옵니다.`)
  console.log(`    지워진 행 ${deleted}건도 변경 로그에만 있습니다.`)
  console.log(`    전체 덤프는 없어진 걸로 알지만, 언제 왜 없어졌는지는 모릅니다.`)
}

/**
 * 2. 스냅샷이 늦으면 답이 얼마나 틀리는가.
 */
async function scenarioStaleSnapshot() {
  console.log(`\n[2] 어제 밤 스냅샷으로 오늘 아침에 답을 내면\n`)

  await resetSchema(pool)
  await seedOrders(pool, ORDERS, DAY)

  // 어제 자정에 찍은 스냅샷. 그때는 전부 살아있는 결제였다.
  await fullDump(pool, s3, 'midnight')
  const atMidnight = await revenueFromLake(conn, DAY, snapshotGlob('midnight'))

  // 새벽에 취소가 들어온다.
  const reader = startChangeReader('lab_order')
  await new Promise((r) => setTimeout(r, 400))
  const canceled = await cancelSome(pool, 0.12)
  await new Promise((r) => setTimeout(r, 1200))
  reader.stop()
  await writeChanges(s3, reader.changes(), 'dawn')

  // 변경 로그를 따라간 쪽은 취소를 알고 있다.
  const withChanges = await revenueFromLake(
    conn, DAY, [snapshotGlob('midnight'), changesGlob('dawn')],
  )
  const truth = await revenueFromDb(conn, pool, DAY)
  const status = await countByStatus(pool)

  console.log(`    새벽에 취소된 주문 ${canceled.toLocaleString()}건`)
  console.log(`    지금 DB 상태 ${JSON.stringify(status)}\n`)
  console.log(`      ${'무엇으로 답했나'.padEnd(24)} ${'본 사람'.padStart(8)} ${'살아있는 주문'.padStart(12)} ${'금액'.padStart(12)}`)
  const line = (l: string, r: Revenue) =>
    console.log(`      ${l.padEnd(24)} ${r.viewers.toLocaleString().padStart(8)} ${r.paidOrders.toLocaleString().padStart(12)} ${won(r.amount).padStart(12)}`)

  line('어제 밤 스냅샷만', atMidnight)
  line('스냅샷 + 변경 로그', withChanges)
  line('운영 DB에 직접 (진짜 값)', truth)

  const off = ((atMidnight.amount - truth.amount) / truth.amount) * 100
  const gap = atMidnight.amount - truth.amount
  console.log(`\n    스냅샷만 쓰면 ${won(gap)}, ${off.toFixed(1)}% 높게 나옵니다.`)
  console.log(`    틀린 게 아니라 어제 자정의 사실입니다. 오늘 아침 회의에서만 틀린 값입니다.`)
  console.log(`    변경 로그를 얹은 쪽은 운영 DB와 같은 답을 냅니다.`)
}

/**
 * 3. 운영 DB에 직접 물으면 서비스가 얼마나 밀리는가.
 *
 * 이 시나리오는 재현하지 못했다. 결과를 그대로 남긴다.
 *
 * 밀릴 거라고 예상하고 만들었는데 안 밀렸다.
 * 단순 집계도, 4초 걸리는 자기 조인도, 그걸 넷 동시에 던져도
 * 주문 조회는 평소와 같았다.
 */
async function scenarioLoadOnService() {
  console.log(`\n[3] 운영 DB에 직접 물을 때 (재현 실패)\n`)

  await fullDump(pool, s3, 'load')

  // 먼저 데워둔다. 첫 몇 번은 연결을 만드는 시간이 섞인다.
  for (let i = 0; i < 300; i++) await lightQuery(pool, `u-${i}`)

  const measure = async (label: string, heavy: () => Promise<unknown>) => {
    const latencies: number[] = []
    let stop = false
    const traffic = (async () => {
      let i = 0
      while (!stop) {
        latencies.push(await lightQuery(pool, `u-${(i++ * 37) % 20000}`))
        await new Promise((r) => setTimeout(r, 2))
      }
    })()
    const t0 = performance.now()
    await heavy()
    const took = Math.round(performance.now() - t0)
    stop = true
    await traffic
    console.log(
      `    ${label.padEnd(28)} 집계 ${String(took).padStart(5)}ms` +
      `  주문 조회 p50 ${percentile(latencies, 50).toFixed(1)}ms` +
      `  p95 ${percentile(latencies, 95).toFixed(1).padStart(6)}ms`,
    )
    return percentile(latencies, 95)
  }

  await measure('아무것도 안 돌릴 때', () => new Promise((r) => setTimeout(r, 4000)))
  await measure('재구매 분석을 운영 DB에서', () => repeatPurchaseFromDb(pool))
  await measure('같은 걸 4개 동시에', () =>
    Promise.all(Array.from({ length: 4 }, () => repeatPurchaseFromDb(pool))))
  await measure('같은 걸 저장소에서', () =>
    repeatPurchaseFromLake(conn, snapshotGlob('load')))

  console.log(`\n    안 밀렸습니다. 아무것도 안 돌릴 때와 차이가 없습니다.`)
  console.log(`    주문 40만 행에 조회 하나가 도는 정도로는 이 DB가 흔들리지 않습니다.`)
  console.log(`\n    마지막 줄이 오히려 느린 건 같은 노트북에서 조회 엔진이 CPU를 쓰기 때문입니다.`)
  console.log(`    실제로는 저기가 다른 기계입니다. 이 값은 재는 방법의 한계입니다.`)
  console.log(`\n    그러니 "운영 DB에 직접 조인하면 서비스가 밀린다"는 여기서 확인 못 했습니다.`)
  console.log(`    가져와서 조인하기로 한 이유는 부하가 아니라 다른 데 있었습니다. README에 적었습니다.`)
}
