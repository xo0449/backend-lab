import { Injectable } from '@nestjs/common'
// 같은 폴더의 배럴에서 가져온다. 자동 import가 흔히 이렇게 넣는다
import { BService } from './index'

@Injectable()
export class AService {
  constructor(readonly b: BService) {}

  hello() {
    return `a sees ${this.b.name()}`
  }
}
