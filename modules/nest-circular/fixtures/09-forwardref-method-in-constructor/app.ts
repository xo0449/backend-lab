import { Module, type INestApplicationContext } from '@nestjs/common'
import { AService } from './a.service'
import { BService } from './b.service'

@Module({ providers: [AService, BService] })
export class AppModule {}

export const probe = (app: INestApplicationContext) => [app.get(AService).hello(), app.get(BService).hello()]
