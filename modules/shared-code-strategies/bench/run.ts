/**
 * 같은 로직을 여러 서비스에 담는 네 가지 방법을 비교한다.
 *
 * 실제 git 저장소와 npm 패키지를 임시 디렉터리에 만들어 돌린다.
 * 재려는 것은 "공통 로직을 고친 뒤 각 서비스가 새 동작을 갖기까지
 * 사람이 무엇을 해야 하는가"다.
 */
import { Workspace, DISCOUNT_V2, DISCOUNT_V3 } from '../src/workspace.js'
import { STRATEGIES } from '../src/strategies.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : undefined
const runs = (n: number) => ONLY === undefined || ONLY === n

/** 할인 상한이 들어가기 전 100000원의 할인액. */
const BEFORE = '10000'
/** 상한이 들어간 뒤. */
const AFTER = '5000'

async function main() {
  const results: Record<string, unknown>[] = []

  // 시나리오 1. 버그 수정이 두 서비스에 반영되기까지
  if (runs(1)) {
    for (const strategy of STRATEGIES) {
      const ws = new Workspace(strategy.name)
      try {
        strategy.setup(ws)
        const before = strategy.runService(ws, 'service-a')

        ws.measure(() => strategy.propagate(ws, DISCOUNT_V2))

        results.push({
          시나리오: '1. 버그 수정 전파',
          방식: strategy.name,
          '명령 수': ws.steps.length,
          '수정 전': before,
          'A 반영': strategy.runService(ws, 'service-a'),
          'B 반영': strategy.runService(ws, 'service-b'),
        })
      } finally {
        ws.cleanup()
      }
    }
  }

  // 시나리오 2. 공통만 고치고 서비스는 아무것도 안 했을 때
  if (runs(2)) {
    for (const strategy of STRATEGIES) {
      if (strategy.name === '복사') continue
      const ws = new Workspace(`only-${strategy.name}`)
      try {
        strategy.setup(ws)
        strategy.changeSharedOnly(ws, DISCOUNT_V2)

        const a = strategy.runService(ws, 'service-a')
        results.push({
          시나리오: '2. 공통만 고쳤을 때',
          방식: strategy.name,
          '서비스 출력': a,
          '서비스에 반영됐는가': a === AFTER ? '즉시 반영' : '그대로',
        })
      } finally {
        ws.cleanup()
      }
    }
  }

  // 시나리오 3. 한 서비스만 새 버전을 받는다
  if (runs(3)) {
    for (const strategy of STRATEGIES) {
      if (strategy.name === '복사') continue
      const ws = new Workspace(`skew-${strategy.name}`)
      try {
        strategy.setup(ws)
        strategy.changeSharedOnly(ws, DISCOUNT_V2)
        const adopted = strategy.adoptOne(ws, 'service-a')

        results.push({
          시나리오: '3. 한 서비스만 채택',
          방식: strategy.name,
          '부분 채택': adopted ? '가능' : '불가',
          'A (채택함)': strategy.runService(ws, 'service-a'),
          'B (안 함)': strategy.runService(ws, 'service-b'),
        })
      } finally {
        ws.cleanup()
      }
    }
  }

  // 시나리오 4. 호환을 깨는 변경이 언제 드러나는가
  if (runs(4)) {
    for (const strategy of STRATEGIES) {
      if (strategy.name === '복사') continue
      const ws = new Workspace(`break-${strategy.name}`)
      try {
        strategy.setup(ws)
        // 공통 쪽에만 호환 깨는 변경을 넣는다. 서비스는 손대지 않는다.
        strategy.changeSharedOnly(ws, DISCOUNT_V3)
        const a = strategy.runService(ws, 'service-a')

        results.push({
          시나리오: '4. 호환 깨는 변경',
          방식: strategy.name,
          '서비스 출력': a,
          '언제 겪는가': a === 'NaN' ? '공통 커밋 즉시' : '버전을 올릴 때',
        })
      } finally {
        ws.cleanup()
      }
    }
  }

  const groups = [
    '1. 버그 수정 전파', '2. 공통만 고쳤을 때',
    '3. 한 서비스만 채택', '4. 호환 깨는 변경',
  ]
  for (const group of groups) {
    const rows = results.filter((r) => r.시나리오 === group)
    if (rows.length === 0) continue
    console.log(`\n## ${group}`)
    console.table(rows.map(({ 시나리오, ...rest }) => rest))
  }
}

main()
