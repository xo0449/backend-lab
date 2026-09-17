import type { S3Client } from '@aws-sdk/client-s3'
import { putText, clearPrefix } from '../../event-storage-layout/src/store.js'
import { kstDate, type LabEvent } from '../../event-storage-layout/src/event.js'
import { AnalyticsTool, isFunnel } from './tool.js'

export const LAKE_PREFIX = 'dual-lake/'

export interface RouteResult {
  toLake: number
  toTool: number
  toolFailed: number
}

/**
 * 같은 이벤트를 두 곳으로 보낸다.
 *
 * 저장소에는 전부 보낸다. 나중에 무엇을 물을지 모르기 때문이다.
 * 도구에는 퍼널에 쓰는 것만 보낸다. 이벤트 수로 돈을 받기 때문이다.
 *
 * 도구 쪽이 실패해도 저장소 적재를 되돌리지 않는다.
 * 되돌리면 원본이 비고, 그게 훨씬 비싼 손해다.
 */
export async function route(
  s3: S3Client,
  tool: AnalyticsTool,
  events: LabEvent[],
  options: { sendAll?: boolean } = {},
): Promise<RouteResult> {
  const byDay = new Map<string, LabEvent[]>()
  for (const e of events) {
    const key = kstDate(e.received_at)
    const list = byDay.get(key) ?? []
    list.push(e)
    byDay.set(key, list)
  }

  for (const [day, list] of byDay) {
    const body = list.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await putText(s3, `${LAKE_PREFIX}dt=${day}/part-${list[0].event_id}.jsonl`, body)
  }

  const picked = options.sendAll ? events : events.filter(isFunnel)
  let toolFailed = 0
  try {
    await tool.send(picked)
  } catch {
    // 도구가 죽어도 여기서 멈추지 않는다. 저장소에는 이미 들어갔다.
    toolFailed = picked.length
  }

  return { toLake: events.length, toTool: picked.length - toolFailed, toolFailed }
}

export async function resetLake(s3: S3Client) {
  await clearPrefix(s3, LAKE_PREFIX)
}
