import { Injectable } from '@nestjs/common'

@Injectable()
export class BService {
  name() {
    return 'b'
  }
}
