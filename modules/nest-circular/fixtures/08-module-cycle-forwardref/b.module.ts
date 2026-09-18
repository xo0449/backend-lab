import { Module, forwardRef } from '@nestjs/common'
import { BService } from './b.service'
import { B2Service } from './b2.service'
import { AModule } from './a.module'

@Module({ imports: [forwardRef(() => AModule)], providers: [BService, B2Service], exports: [BService] })
export class BModule {}
