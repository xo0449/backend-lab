import { Module, type INestApplicationContext } from '@nestjs/common'
import { AService } from './a.service'
import { BService } from './b.service'
import { Bus } from './bus'

@Module({ providers: [AService, BService, Bus] })
export class AppModule {}

export const probe = (app: INestApplicationContext) => {
  const a = app.get(AService)
  app.get(BService).finish(7)
  return [a.hello(), `a heard ${a.seen.join(',')}`]
}
