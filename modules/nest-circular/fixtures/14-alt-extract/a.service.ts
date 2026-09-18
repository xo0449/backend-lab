import { Injectable } from '@nestjs/common'
import { NamesService } from './names.service'

@Injectable()
export class AService {
  constructor(private readonly names: NamesService) {}

  hello() {
    return `a sees ${this.names.of('b')}`
  }
}
