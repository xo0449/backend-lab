import { Inject, Injectable, forwardRef } from '@nestjs/common'
import { BService } from './b.service'

@Injectable()
export class AService {
  constructor(@Inject(forwardRef(() => BService)) readonly b: BService) {}

  name() {
    return 'a'
  }

  hello() {
    return `a sees ${this.b.name()}`
  }
}
