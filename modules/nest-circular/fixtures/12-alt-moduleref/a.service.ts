import { Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { BService } from './b.service'

@Injectable()
export class AService {
  constructor(private readonly moduleRef: ModuleRef) {}

  name() {
    return 'a'
  }

  hello() {
    // 생성자에서 받지 않고 부르는 순간에 꺼낸다
    const b = this.moduleRef.get(BService, { strict: false })
    return `a sees ${b.name()}`
  }
}
