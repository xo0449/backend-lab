import { describe, it, expect, beforeAll } from 'vitest'
import type { DuckDBConnection } from '@duckdb/node-api'
import { createS3, ensureBucket } from '../../event-storage-layout/src/store.js'
import { openEngine } from '../../event-storage-layout/src/scan.js'
import { generateDay, kstDate } from '../../event-storage-layout/src/event.js'
import { AnalyticsTool, isFunnel } from './tool.js'
import { route, resetLake } from './router.js'
import { reconcile, totalMissing, detectionDelay } from './reconcile.js'

const DAY = '2026-09-16'
const COUNT = 6000
const s3 = createS3()
let conn: DuckDBConnection

beforeAll(async () => {
  await ensureBucket(s3)
  conn = await openEngine()
}, 60_000)

describe('무엇을 보낼 것인가', () => {
  it('퍼널에 쓰는 것만 고르면 보내는 수가 준다', () => {
    const events = generateDay(DAY, COUNT, 7)
    const picked = events.filter(isFunnel)
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.length).toBeLessThan(events.length)
  })
})

describe('한쪽만 끊겼을 때', () => {
  it('도구가 죽어도 저장소 적재는 멈추지 않는다', async () => {
    const tool = new AnalyticsTool()
    await resetLake(s3)
    tool.setMode('down')

    const events = generateDay(DAY, 500, 7)
    const r = await route(s3, tool, events)

    expect(r.toLake).toBe(events.length)
    expect(r.toTool).toBe(0)
    expect(r.toolFailed).toBeGreaterThan(0)
    expect(tool.count).toBe(0)
  }, 60_000)

  it('끊긴 구간만큼만 벌어지고 나머지는 들어간다', async () => {
    const tool = new AnalyticsTool()
    await resetLake(s3)

    const events = generateDay(DAY, 2000, 7)
    const half = Math.floor(events.length / 2)
    tool.setMode('down')
    await route(s3, tool, events.slice(0, half))
    tool.setMode('ok')
    await route(s3, tool, events.slice(half))

    const funnel = events.filter(isFunnel).length
    expect(tool.count).toBeGreaterThan(0)
    expect(tool.count).toBeLessThan(funnel)
  }, 60_000)
})

describe('대조', () => {
  it('저장소를 기준으로 세면 빠진 건수가 나온다', async () => {
    const tool = new AnalyticsTool()
    await resetLake(s3)

    const events = generateDay(DAY, 2000, 7)
    const half = Math.floor(events.length / 2)
    tool.setMode('down')
    await route(s3, tool, events.slice(0, half))
    tool.setMode('ok')
    await route(s3, tool, events.slice(half))

    const gaps = await reconcile(conn, tool, kstDate(events[0].received_at))
    expect(gaps.length).toBeGreaterThan(0)
    expect(totalMissing(gaps)).toBeGreaterThan(0)
    // 저장소 쪽이 항상 같거나 많다. 전부 들어가는 쪽이 그쪽이다.
    for (const g of gaps) expect(g.inLake).toBeGreaterThanOrEqual(g.inTool)
  }, 60_000)

  it('아무것도 안 빠졌으면 차이가 0이다', async () => {
    const tool = new AnalyticsTool()
    await resetLake(s3)
    const events = generateDay(DAY, 2000, 7)
    await route(s3, tool, events)

    const gaps = await reconcile(conn, tool, kstDate(events[0].received_at))
    expect(totalMissing(gaps)).toBe(0)
  }, 60_000)

  it('대조 주기가 곧 알아채기까지 걸리는 시간이다', () => {
    expect(detectionDelay(0, 1)).toBe(1)
    expect(detectionDelay(0, 7)).toBe(7)
    // 주기 중간에 고장 나면 남은 날만큼만 기다린다.
    expect(detectionDelay(5, 7)).toBe(2)
  })
})

describe('빠진 것을 다시 보낼 때', () => {
  it('멱등 열쇠가 없으면 재전송이 중복이 된다', async () => {
    const tool = new AnalyticsTool(false)
    const events = generateDay(DAY, 500, 7).filter(isFunnel)
    await tool.send(events)
    const before = tool.count
    await tool.send(events)
    expect(tool.count).toBe(before * 2)
  })

  it('멱등 열쇠가 있으면 몇 번을 보내도 한 번만 센다', async () => {
    const tool = new AnalyticsTool(true)
    const events = generateDay(DAY, 500, 7).filter(isFunnel)
    await tool.send(events)
    const before = tool.count
    await tool.send(events)
    await tool.send(events)
    expect(tool.count).toBe(before)
  })
})
