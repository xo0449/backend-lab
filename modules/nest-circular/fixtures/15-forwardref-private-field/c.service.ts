import { Injectable } from '@nestjs/common'

/** 대조군. 같은 # 필드를 쓰지만 순환에 끼어 있지 않다 */
@Injectable()
export class CService {
  #limit = 100

  limit() {
    return this.#limit
  }
}
