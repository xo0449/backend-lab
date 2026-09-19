import { createHash } from 'node:crypto'

// PE(Windows 실행 파일)에서 Authenticode가 해시에 넣지 않는 세 곳을 찾는다.
//   1. 옵셔널 헤더의 CheckSum 4바이트. 서명을 붙이면 파일이 바뀌니 체크섬도 바뀐다
//   2. 데이터 디렉터리의 Certificate Table 항목 8바이트(위치, 크기). 서명을 붙여야 값이 정해진다
//   3. Certificate Table 자체. 서명이 들어가는 자리다. 자기 자신을 해시할 수는 없다
// 근거: Microsoft "Windows Authenticode Portable Executable Signature Format" (2008)

export interface PeLayout {
  /** PE32면 false, PE32+(64비트)면 true */
  is64: boolean
  checksumOffset: number
  certDirOffset: number
  /** 서명이 없으면 null */
  certTable: { offset: number; size: number } | null
}

export function parsePe(buf: Buffer): PeLayout {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error('MZ 헤더가 아니다')
  const pe = buf.readUInt32LE(0x3c)
  if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) throw new Error('PE 시그니처가 없다')
  const opt = pe + 24
  const magic = buf.readUInt16LE(opt)
  if (magic !== 0x10b && magic !== 0x20b) throw new Error(`모르는 옵셔널 헤더 magic 0x${magic.toString(16)}`)
  const is64 = magic === 0x20b
  const checksumOffset = opt + 64
  // 데이터 디렉터리는 PE32에서 옵셔널 헤더 +96, PE32+에서 +112에 시작한다. 항목 하나가 8바이트, 다섯 번째(4)가 Certificate Table
  const certDirOffset = opt + (is64 ? 112 : 96) + 4 * 8
  const offset = buf.readUInt32LE(certDirOffset)
  const size = buf.readUInt32LE(certDirOffset + 4)
  const certTable = offset !== 0 && size !== 0 ? { offset, size } : null
  if (certTable && certTable.offset + certTable.size > buf.length) throw new Error('Certificate Table이 파일 밖을 가리킨다')
  return { is64, checksumOffset, certDirOffset, certTable }
}

/** 해시에 들어가는 구간들. [시작, 끝) */
export function hashedRanges(buf: Buffer, layout = parsePe(buf)): [number, number][] {
  const end = layout.certTable ? layout.certTable.offset : buf.length
  const ranges: [number, number][] = [
    [0, layout.checksumOffset],
    [layout.checksumOffset + 4, layout.certDirOffset],
    [layout.certDirOffset + 8, end],
  ]
  // Certificate Table 뒤에 뭔가 더 있으면 그것도 넣는다. 보통은 표가 파일의 끝이다
  if (layout.certTable && layout.certTable.offset + layout.certTable.size < buf.length) {
    ranges.push([layout.certTable.offset + layout.certTable.size, buf.length])
  }
  return ranges
}

export function authenticodeDigest(buf: Buffer, algorithm = 'sha256'): Buffer {
  const h = createHash(algorithm)
  for (const [a, b] of hashedRanges(buf)) h.update(buf.subarray(a, b))
  return h.digest()
}

/** 해시에 안 들어가는 바이트 수 */
export function excludedBytes(buf: Buffer): number {
  return buf.length - hashedRanges(buf).reduce((n, [a, b]) => n + (b - a), 0)
}
