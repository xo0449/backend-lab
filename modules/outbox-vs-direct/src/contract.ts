/**
 * 이벤트 계약. 아웃박스를 한 도메인에서 쓰는 것과
 * 여러 도메인이 함께 쓰는 기반으로 만드는 것은 다른 일이다.
 *
 * 기반으로 만들려면 "누가 무엇을 발행하고 누가 소비하는가"를
 * 한곳에 적고, 부팅 시점에 검증해야 한다.
 * 이게 없으면 발행자와 소비자가 서로 다른 가정을 갖게 되고,
 * 그 차이는 운영 중에만 드러난다.
 */

export type AppName = 'order-api' | 'partner-api' | 'job'

export interface EventDef {
  /** 이 이벤트를 발행할 수 있는 앱. 여기 없는 앱이 발행하면 부팅이 실패한다. */
  publishers: AppName[]
  /**
   * 소비 앱. 반드시 하나다.
   * 큐는 작업 큐라 두 앱이 같은 큐를 보면 나눠 가진다. 복제가 아니다.
   * 두 곳에 보내야 하면 이벤트를 나누거나 팬아웃 계층을 따로 둬야 한다.
   */
  consumer: AppName
  /** 전용 큐 이름. 이벤트끼리 큐를 공유하지 않는다. */
  queue: string
  /** 멱등키를 만드는 함수. 같은 사실은 같은 키가 나와야 한다. */
  dedupKey: (payload: any) => string
}

export const EVENT_DEFS = {
  OrderPlaced: {
    publishers: ['order-api'],
    consumer: 'partner-api',
    queue: 'order-placed',
    dedupKey: (p) => buildDedupKey('OrderPlaced', p.orderId),
  },
  OrderCancelled: {
    publishers: ['order-api', 'job'],
    consumer: 'partner-api',
    queue: 'order-cancelled',
    dedupKey: (p) => buildDedupKey('OrderCancelled', p.orderId, p.reason),
  },
} as const satisfies Record<string, EventDef>

export type EventType = keyof typeof EVENT_DEFS

/**
 * 구분자가 값 안에 섞이면 서로 다른 발행이 같은 키가 되어 하나가 사라진다.
 * 각 조각을 이스케이프한다.
 */
export function buildDedupKey(eventType: string, ...parts: unknown[]): string {
  const key = [eventType, ...parts.map((p) => encodeURIComponent(String(p)))].join(':')
  if (key.length > 160) {
    throw new Error(`dedupKey가 160자를 넘는다: ${key.slice(0, 40)}...`)
  }
  return key
}

/**
 * 부팅 시 한 번 돈다. 어긋난 정의는 배포 전에 잡는다.
 * 운영 중에 드러나면 이미 잡이 잘못된 큐에 쌓인 뒤다.
 */
export function validateEventPolicy(): void {
  const queues = new Map<string, string>()

  for (const [type, def] of Object.entries(EVENT_DEFS) as [string, EventDef][]) {
    if (def.publishers.length === 0) {
      throw new Error(`[${type}] 발행 앱이 없다`)
    }
    const owner = queues.get(def.queue)
    if (owner) {
      throw new Error(`[${type}] 큐 '${def.queue}'를 ${owner}와 공유한다`)
    }
    queues.set(def.queue, type)
  }
}

export function assertCanPublish(app: AppName, type: EventType): void {
  const def = EVENT_DEFS[type] as EventDef
  if (!def.publishers.includes(app)) {
    throw new Error(`[${type}] ${app}은 발행 권한이 없다`)
  }
}
