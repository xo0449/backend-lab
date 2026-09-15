import mysql from 'mysql2/promise'

export function createPool() {
  return mysql.createPool({
    host: '127.0.0.1',
    port: 3307,
    user: 'root',
    password: 'lab',
    database: 'lab',
    connectionLimit: 10,
  })
}
