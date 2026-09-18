import { Injectable } from '@nestjs/common'
import { AService } from './a.service'

@Injectable()
export class BService {
  constructor(readonly a: AService) {}

  name() {
    return 'b'
  }

  hello() {
    return `b sees ${this.a.name()}`
  }
}
