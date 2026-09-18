import { Module, type INestApplicationContext } from '@nestjs/common'
import { AService, BService } from './index'

@Module({ providers: [AService, BService] })
export class AppModule {}

export const probe = (app: INestApplicationContext) => app.get(AService).hello()
