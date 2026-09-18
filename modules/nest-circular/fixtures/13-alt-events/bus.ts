import { Injectable } from '@nestjs/common'
import { EventEmitter } from 'node:events'

@Injectable()
export class Bus extends EventEmitter {}
