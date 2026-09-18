import { Module, type INestApplicationContext } from '@nestjs/common'
import { AModule } from './a.module'
import { BModule } from './b.module'
import { AService } from './a.service'
import { B2Service } from './b2.service'

@Module({ imports: [AModule, BModule] })
export class AppModule {}

export const probe = (app: INestApplicationContext) => [
  app.get(AService, { strict: false }).hello(),
  app.get(B2Service, { strict: false }).hello(),
]
