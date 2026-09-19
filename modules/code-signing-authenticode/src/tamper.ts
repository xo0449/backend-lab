import { parsePe } from './pe'

// 서명된 파일을 고쳐 보는 방법들. 전부 사본을 돌려준다.

export function flipBit(buf: Buffer, at: number): Buffer {
  const out = Buffer.from(buf)
  out[at] = out[at]! ^ 0x01
  return out
}

export function setChecksum(buf: Buffer, value: number): Buffer {
  const out = Buffer.from(buf)
  out.writeUInt32LE(value >>> 0, parsePe(buf).checksumOffset)
  return out
}

/** 파일 끝에 그냥 덧붙인다. Certificate Table의 크기는 그대로 둔다 */
export function appendAfterTable(buf: Buffer, extra: Buffer): Buffer {
  return Buffer.concat([buf, extra])
}

/**
 * Certificate Table을 늘려서 그 안에 넣는다. 디렉터리의 크기와 WIN_CERTIFICATE의 dwLength를 같이 올린다.
 * PKCS#7 덩어리는 자기 길이를 DER 안에 갖고 있어서 뒤에 붙은 것은 읽히지 않는다.
 * 8바이트 경계에 맞춘다(표의 항목은 8바이트 정렬이다).
 */
export function padInsideTable(buf: Buffer, extra: Buffer): Buffer {
  const { certTable, certDirOffset } = parsePe(buf)
  if (!certTable) throw new Error('서명이 없는 파일이다')
  if (certTable.offset + certTable.size !== buf.length) throw new Error('Certificate Table이 파일 끝에 있지 않다')
  const padded = Buffer.concat([extra, Buffer.alloc((8 - (extra.length % 8)) % 8)])
  const out = Buffer.concat([buf, padded])
  out.writeUInt32LE(certTable.size + padded.length, certDirOffset + 4)
  out.writeUInt32LE(out.readUInt32LE(certTable.offset) + padded.length, certTable.offset)
  return out
}
