import { Injectable } from '@nestjs/common'
import { A2Service } from './a2.service'

@Injectable()
export class B2Service {
  constructor(readonly a2: A2Service) {}

  hello() {
    return `b2 sees ${this.a2.name()}`
  }
}
