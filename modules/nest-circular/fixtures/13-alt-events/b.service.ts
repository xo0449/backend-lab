import { Injectable } from '@nestjs/common'
import { Bus } from './bus'

@Injectable()
export class BService {
  constructor(private readonly bus: Bus) {}

  name() {
    return 'b'
  }

  finish(orderId: number) {
    // A를 부르는 대신 일어난 일을 알린다
    this.bus.emit('b.finished', orderId)
  }
}
