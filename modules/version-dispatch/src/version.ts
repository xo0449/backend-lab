/**
 * 버전 비교를 값으로 다룬다.
 *
 * 문자열을 매번 split해서 major, minor를 꺼내 비교하면
 * 그 비교가 코드 곳곳에 흩어진다. 흩어지면 한 군데를 빠뜨린다.
 */
export class Version {
  private constructor(
    readonly major: number,
    readonly minor: number,
    readonly patch: number,
  ) {}

  static parse(text: string): Version {
    const [major = 0, minor = 0, patch = 0] = text.split('.').map(Number)
    if ([major, minor, patch].some(Number.isNaN)) {
      throw new Error(`버전 형식이 올바르지 않습니다: ${text}`)
    }
    return new Version(major, minor, patch)
  }

  compare(other: Version): number {
    return (
      this.major - other.major ||
      this.minor - other.minor ||
      this.patch - other.patch
    )
  }

  gte(other: Version): boolean {
    return this.compare(other) >= 0
  }

  toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`
  }
}
