import { Inject, Injectable, forwardRef } from '@nestjs/common'
import { BService } from './b.service'

@Injectable()
export class AService {
  readonly greeting: string

  constructor(@Inject(forwardRef(() => BService)) readonly b: BService) {
    // 주입받은 걸 생성자에서 바로 쓴다. 캐시를 데우거나 설정을 읽을 때 흔히 이렇게 짠다
    this.greeting = `a sees ${this.b.name()}`
  }

  name() {
    return 'a'
  }

  hello() {
    return this.greeting
  }
}
