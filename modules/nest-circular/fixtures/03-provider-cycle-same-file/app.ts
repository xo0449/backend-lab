import { Injectable, Module, type INestApplicationContext } from '@nestjs/common'

// 파일이 하나라 파일 import 순환이 없다. 남는 건 DI 순환뿐이다
@Injectable()
export class AService {
  constructor(readonly b: BService) {}
  name() {
    return 'a'
  }
  hello() {
    return `a sees ${this.b.name()}`
  }
}

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

@Module({ providers: [AService, BService] })
export class AppModule {}

export const probe = (app: INestApplicationContext) => [app.get(AService).hello(), app.get(BService).hello()]
