import { Inject, Injectable, forwardRef } from '@nestjs/common'
import { AService } from './a.service'

@Injectable()
export class BService {
  // TypeScript의 private이 아니라 자바스크립트의 # 필드다
  #limit = 100

  constructor(@Inject(forwardRef(() => AService)) readonly a: AService) {}

  limit() {
    return this.#limit
  }

  peerLimit() {
    return this.a.limit()
  }
}
