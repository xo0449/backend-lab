import { Module, type INestApplicationContext } from '@nestjs/common'
import { AService } from './a.service'
import { BService } from './b.service'

@Module({ providers: [AService, BService] })
export class AppModule {}

export const probe = (app: INestApplicationContext) => {
  const a = app.get(AService)
  const b = app.get(BService)
  return {
    'a.b는 컨테이너의 B와 같은 객체인가': a.b === b,
    'b.a는 컨테이너의 A와 같은 객체인가': b.a === a,
    'A 생성자에서 본 b.limit': a.peerLimitSeenInConstructor ?? 'undefined',
    'B 생성자에서 본 a.limit': b.peerLimitSeenInConstructor ?? 'undefined',
    '부팅이 끝난 뒤 a.b.limit': a.b.limit ?? 'undefined',
    '부팅이 끝난 뒤 b.a.limit': b.a.limit ?? 'undefined',
  }
}
