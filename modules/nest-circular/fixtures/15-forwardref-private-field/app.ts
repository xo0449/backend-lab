import { Module, type INestApplicationContext } from '@nestjs/common'
import { AService } from './a.service'
import { BService } from './b.service'
import { CService } from './c.service'

@Module({ providers: [AService, BService, CService] })
export class AppModule {}

const attempt = (f: () => unknown) => {
  try {
    return f()
  } catch (e) {
    return `던짐: ${(e as Error).message}`
  }
}

// 생성자에서는 아무것도 안 한다. 부팅이 다 끝난 뒤에 부른다
export const probe = (app: INestApplicationContext) => {
  const a = app.get(AService)
  const b = app.get(BService)
  return {
    '순환 밖의 c.limit()': attempt(() => app.get(CService).limit()),
    'a.limit()': attempt(() => a.limit()),
    'b.limit()': attempt(() => b.limit()),
    'a.peerLimit()': attempt(() => a.peerLimit()),
    'b.peerLimit()': attempt(() => b.peerLimit()),
  }
}
