import { Injectable } from '@nestjs/common'
import { NamesService } from './names.service'

@Injectable()
export class BService {
  constructor(private readonly names: NamesService) {}

  hello() {
    return `b sees ${this.names.of('a')}`
  }
}
