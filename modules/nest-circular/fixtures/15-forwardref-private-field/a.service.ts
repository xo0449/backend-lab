import { Inject, Injectable, forwardRef } from '@nestjs/common'
import { BService } from './b.service'

@Injectable()
export class AService {
  // TypeScript의 private이 아니라 자바스크립트의 # 필드다
  #limit = 100

  constructor(@Inject(forwardRef(() => BService)) readonly b: BService) {}

  limit() {
    return this.#limit
  }

  peerLimit() {
    return this.b.limit()
  }
}
