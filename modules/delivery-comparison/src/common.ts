import mysql from 'mysql2/promise'

export const MYSQL = {
  host: '127.0.0.1', port: 3307,
  user: 'root', password: 'lab', database: 'lab',
}

/** binlog를 읽으려면 복제 권한이 있는 계정이 따로 필요하다. */
export const REPL = { host: '127.0.0.1', port: 3307, user: 'repl', password: 'repl' }

export const KAFKA_BROKER = '127.0.0.1:9094'

export function createPool() {
  return mysql.createPool({ ...MYSQL, connectionLimit: 10 })
}

export interface Delivered {
  aggregate: string
  at: number
}

/**
 * 수신 기록. 세 방식이 같은 곳에 도착하게 해서 비교 조건을 맞춘다.
 * 중복도 그대로 기록한다. 중복을 세는 것이 이 실험의 목적 중 하나다.
 */
export class Sink {
  readonly items: Delivered[] = []

  receive(aggregate: string) {
    this.items.push({ aggregate, at: Date.now() })
  }

  count(aggregate: string) {
    return this.items.filter((i) => i.aggregate === aggregate).length
  }

  get unique() {
    return new Set(this.items.map((i) => i.aggregate)).size
  }

  get total() {
    return this.items.length
  }

  clear() {
    this.items.length = 0
  }
}
