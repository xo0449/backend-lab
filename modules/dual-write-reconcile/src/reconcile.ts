import type { DuckDBConnection } from '@duckdb/node-api'
import { BUCKET } from '../../event-storage-layout/src/store.js'
import { LAKE_PREFIX } from './router.js'
import { AnalyticsTool, FUNNEL_EVENTS } from './tool.js'

export interface Gap {
  name: string
  inLake: number
  inTool: number
  missing: number
}

/**
 * 양쪽 건수를 맞춰본다.
 *
 * 경로가 둘이면 고장도 둘이다. 그런데 둘 다 조용히 고장 난다.
 * 저장소에는 계속 쌓이고 도구 화면에도 숫자가 나오니까,
 * 어느 쪽이 빠졌는지는 세어보기 전에는 알 수 없다.
 *
 * 저장소를 기준으로 삼는다. 전부 들어가 있는 쪽이 그쪽이기 때문이다.
 */
export async function reconcile(
  conn: DuckDBConnection,
  tool: AnalyticsTool,
  day: string,
): Promise<Gap[]> {
  const reader = await conn.runAndReadAll(`
    SELECT name, count(*) AS n
    FROM read_json_auto('s3://${BUCKET}/${LAKE_PREFIX}dt=${day}/*.jsonl')
    WHERE name IN (${FUNNEL_EVENTS.map((n) => `'${n}'`).join(', ')})
    GROUP BY name ORDER BY name
  `)

  const out: Gap[] = []
  for (const [name, n] of reader.getRows()) {
    const inLake = Number(n)
    const inTool = tool.countOf(String(name))
    out.push({ name: String(name), inLake, inTool, missing: inLake - inTool })
  }
  return out
}

export function totalMissing(gaps: Gap[]): number {
  return gaps.reduce((sum, g) => sum + Math.max(0, g.missing), 0)
}

/**
 * 대조를 며칠에 한 번 돌리느냐가 곧 알아채기까지 걸리는 시간이다.
 *
 * 고장이 난 날부터 다음 대조까지 벌어진 것은 아무도 모른다.
 * 그 사이에 누군가 그 숫자로 판단을 내린다.
 */
export function detectionDelay(brokenOnDay: number, everyNDays: number): number {
  const next = Math.ceil((brokenOnDay + 1) / everyNDays) * everyNDays
  return next - brokenOnDay
}
