import { Injectable } from '@nestjs/common'
import { Bus } from './bus'
import { BService } from './b.service'

@Injectable()
export class AService {
  readonly seen: number[] = []

  constructor(
    readonly b: BService,
    bus: Bus,
  ) {
    bus.on('b.finished', (orderId: number) => this.seen.push(orderId))
  }

  hello() {
    return `a sees ${this.b.name()}`
  }
}
