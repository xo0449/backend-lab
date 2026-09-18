import { Module, forwardRef } from '@nestjs/common'
import { AService } from './a.service'
import { A2Service } from './a2.service'
import { BModule } from './b.module'

@Module({ imports: [forwardRef(() => BModule)], providers: [AService, A2Service], exports: [A2Service] })
export class AModule {}
