/**
 * 짧은 TTL 캐시. 진행 중인 요청을 공유한다.
 *
 * TTL만 있으면 캐시가 빈 순간 동시에 들어온 요청이 전부 DB로 간다.
 * 무거운 집계에서는 그 순간이 곧 장애다. 그래서 진행 중인 약속을
 * 들고 있다가 뒤따라온 요청에 같은 것을 돌려준다.
 */
export class ShortCache<T> {
  private value?: { data: T; expiresAt: number }
  private inFlight?: Promise<T>
  private missCount = 0

  constructor(private readonly ttlMs: number) {}

  get misses() {
    return this.missCount
  }

  async get(load: () => Promise<T>): Promise<T> {
    const now = Date.now()
    if (this.value && this.value.expiresAt > now) return this.value.data
    if (this.inFlight) return this.inFlight

    this.missCount += 1
    this.inFlight = load()
      .then((data) => {
        this.value = { data, expiresAt: Date.now() + this.ttlMs }
        return data
      })
      .finally(() => {
        this.inFlight = undefined
      })

    return this.inFlight
  }
}
