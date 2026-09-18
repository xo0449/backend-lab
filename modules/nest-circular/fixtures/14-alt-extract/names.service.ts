import { Injectable } from '@nestjs/common'

/** A와 B가 서로에게서 필요했던 건 이름뿐이었다. 그걸 여기로 옮겼다 */
@Injectable()
export class NamesService {
  of(who: 'a' | 'b') {
    return who
  }
}
