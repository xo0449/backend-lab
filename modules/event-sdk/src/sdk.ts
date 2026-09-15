import { defaultTransport, type Transport } from './transport.js'

export interface SdkOptions {
  endpoint: string
  maxBatchSize?: number
  flushIntervalMs?: number
  /** 기본 true. 끄면 아무것도 보내지 않는다. */
  enabled?: boolean
  transport?: Transport
  /** 큐 상한. 넘으면 오래된 것부터 버린다. */
  maxQueueSize?: number
}

export interface EventSdk {
  track(name: string, payload?: Record<string, unknown>): void
  flush(): Promise<void>
  /** 페이지를 떠날 때. 기다리지 않는다. */
  flushSync(): void
}

interface QueuedEvent {
  eventId: string
  name: string
  occurredAt: string
  schemaVersion: number
  payload: Record<string, unknown>
}

const SCHEMA_VERSION = 1

/**
 * SDK 오류가 호스트 앱으로 새어 나가면 안 된다.
 * 분석 코드 때문에 서비스가 멈추는 것은 어떤 경우에도 정당화되지 않는다.
 *
 * 빈 catch는 보통 나쁜 신호지만 여기서는 의도다.
 * 삼키는 것이 이 함수의 목적이다.
 */
function safely(fn: () => void): void {
  try {
    fn()
  } catch {
    // 의도적으로 삼킨다. 위 주석 참고.
  }
}

export function createSdk(options: SdkOptions): EventSdk {
  const {
    endpoint,
    maxBatchSize = 20,
    flushIntervalMs = 5_000,
    enabled = true,
    transport = defaultTransport(),
    maxQueueSize = 500,
  } = options

  let queue: QueuedEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  function drain(): QueuedEvent[] {
    const batch = queue
    queue = []
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    return batch
  }

  /**
   * 어떤 경우에도 거부하지 않는다.
   *
   * safely()는 동기 예외만 잡는다. 전송이 비동기로 실패하면
   * 처리되지 않은 거부가 되어 호스트 앱 밖으로 새어 나간다.
   * Node는 기본 설정에서 그걸로 프로세스를 죽인다.
   * 분석 코드가 서비스를 내리는 정확한 경로다.
   *
   * 실패해도 다시 큐에 넣지 않는다. 재시도 폭주가 호스트 앱을
   * 더 망가뜨린다. 유실을 받아들이는 쪽이 낫다.
   */
  async function send(batch: QueuedEvent[]): Promise<void> {
    if (batch.length === 0) return
    try {
      await transport.send(endpoint, JSON.stringify(batch))
    } catch {
      // 전송 실패는 호스트 앱의 문제가 아니다.
    }
  }

  const sdk: EventSdk = {
    track(name, payload = {}) {
      if (!enabled) return
      safely(() => {
        queue.push({
          eventId: newId(),
          name,
          occurredAt: new Date().toISOString(),
          schemaVersion: SCHEMA_VERSION,
          payload,
        })

        // 큐가 넘치면 오래된 것부터 버린다.
        // 메모리를 무한정 쓰느니 옛 이벤트를 잃는 편이 낫다.
        if (queue.length > maxQueueSize) {
          queue = queue.slice(queue.length - maxQueueSize)
        }

        if (queue.length >= maxBatchSize) {
          void send(drain())
          return
        }
        timer ??= setTimeout(() => void send(drain()), flushIntervalMs)
      })
    },

    async flush() {
      if (!enabled) return
      await send(drain())
    },

    flushSync() {
      if (!enabled) return
      safely(() => {
        const batch = drain()
        if (batch.length === 0) return
        const body = JSON.stringify(batch)
        if (transport.sendSync) transport.sendSync(endpoint, body)
        else void transport.send(endpoint, body).catch(() => {})
      })
    },
  }

  // 페이지를 떠날 때 남은 이벤트를 보낸다.
  //
  // beforeunload가 아니라 visibilitychange를 쓴다.
  // 모바일 브라우저는 탭을 백그라운드로 보내거나 앱을 전환할 때
  // beforeunload를 부르지 않는 경우가 있다. 그대로 두면 모바일
  // 사용자의 마지막 이벤트가 통째로 사라진다.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    safely(() => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') sdk.flushSync()
      })
    })
  }

  return sdk
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
