import { Inject, Injectable, forwardRef } from '@nestjs/common'
import { AService } from './a.service'

@Injectable()
export class BService {
  /** 생성자에서 채우는 필드. 설정값이나 캐시가 보통 이런 모양이다 */
  readonly limit: number
  /** 생성자가 도는 그 순간에 상대의 limit이 얼마로 보였는가 */
  readonly peerLimitSeenInConstructor: number | undefined

  constructor(@Inject(forwardRef(() => AService)) readonly a: AService) {
    this.limit = 100
    this.peerLimitSeenInConstructor = this.a.limit
  }

  /** 필드를 안 보는 메서드 */
  name() {
    return 'b'
  }
}
