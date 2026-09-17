import { describe, it, expect, beforeAll } from 'vitest'
import type { DuckDBConnection } from '@duckdb/node-api'
import type { Pool } from 'mysql2/promise'
import { createS3, ensureBucket } from '../../event-storage-layout/src/store.js'
import { openEngine } from '../../event-storage-layout/src/scan.js'
import { seedLayouts } from '../../event-storage-layout/src/layout.js'
import {
  createPool, resetSchema, seedOrders, cancelSome, flipTwice, deleteOrder, countByStatus,
} from './orders.js'
import { fullDump, incrementalPoll, startChangeReader, writeChanges } from './extract.js'
import { revenueFromLake, revenueFromDb, snapshotGlob, changesGlob } from './join.js'

const DAY = '2026-09-16'
const ORDERS = 20000
const s3 = createS3()
let conn: DuckDBConnection
let pool: Pool

const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  await ensureBucket(s3)
  conn = await openEngine()
  pool = createPool()
  await seedLayouts(s3, conn, 20000)
}, 180_000)

describe('가져오는 방법마다 보이는 것이 다르다', () => {
  it('변경 로그는 같은 행이 두 번 바뀐 것을 두 번 본다', async () => {
    await resetSchema(pool)
    await seedOrders(pool, 200, DAY)

    const reader = startChangeReader('lab_order')
    await settle(400)
    await flipTwice(pool, 7)
    await settle()
    reader.stop()

    const seen = reader.changes().filter((c) => c.order_id === 7)
    expect(seen.length).toBe(2)
  }, 60_000)

  it('폴링은 두 번 바뀐 행을 한 번만 가져온다', async () => {
    await resetSchema(pool)
    await seedOrders(pool, 200, DAY)
    const before = new Date(Date.now() - 1000).toISOString().slice(0, 23).replace('T', ' ')
    await flipTwice(pool, 7)

    const n = await incrementalPoll(pool, s3, before, 'test')
    expect(n).toBe(1)
  }, 60_000)

  it('지워진 행은 변경 로그에만 나타난다', async () => {
    await resetSchema(pool)
    await seedOrders(pool, 200, DAY)

    const reader = startChangeReader('lab_order')
    await settle(400)
    await deleteOrder(pool, 11)
    await settle()
    reader.stop()

    expect(reader.changes().filter((c) => c.deleted).length).toBe(1)

    // 폴링은 사라진 행을 SELECT로 볼 방법이 없다.
    const before = new Date(Date.now() - 3000).toISOString().slice(0, 23).replace('T', ' ')
    const polled = await incrementalPoll(pool, s3, before, 'test')
    expect(polled).toBe(0)
  }, 60_000)

  it('전체 덤프는 지워진 행이 없는 상태로 찍힌다', async () => {
    await resetSchema(pool)
    await seedOrders(pool, 200, DAY)
    await deleteOrder(pool, 11)
    const dumped = await fullDump(pool, s3, 'test')
    expect(dumped).toBe(199)
  }, 60_000)
})

describe('늦은 스냅샷', () => {
  it('취소를 모르는 스냅샷은 금액을 높게 낸다', async () => {
    await resetSchema(pool)
    await seedOrders(pool, ORDERS, DAY)
    await fullDump(pool, s3, 'mid')
    const stale = await revenueFromLake(conn, DAY, snapshotGlob('mid'))

    const reader = startChangeReader('lab_order')
    await settle(400)
    const canceled = await cancelSome(pool, 0.12)
    await settle(1200)
    reader.stop()
    await writeChanges(s3, reader.changes(), 'test')

    expect(canceled).toBeGreaterThan(0)

    const fresh = await revenueFromLake(conn, DAY, [snapshotGlob('mid'), changesGlob('test')])
    const truth = await revenueFromDb(conn, pool, DAY)

    expect(stale.amount).toBeGreaterThan(fresh.amount)
    // 변경 로그를 얹으면 운영 DB와 같은 답이 나와야 한다. 여기가 어긋나면
    // 마지막 모습을 고르는 규칙이 틀린 것이다.
    expect(fresh.amount).toBe(truth.amount)
    expect(fresh.paidOrders).toBe(truth.paidOrders)
  }, 180_000)

  it('취소가 DB에 실제로 반영돼 있다', async () => {
    const status = await countByStatus(pool)
    expect(status.CANCELED).toBeGreaterThan(0)
    expect(status.PAID).toBeGreaterThan(0)
  }, 60_000)
})
