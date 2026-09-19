import { describe, expect, it } from 'vitest'
import { oid, readDer } from './der'
import { authenticodeDigest, excludedBytes, hashedRanges, parsePe } from './pe'
import { appendAfterTable, flipBit, padInsideTable, setChecksum } from './tamper'

// 진짜 실행 파일 없이 돌도록 헤더만 있는 가짜 PE를 만든다. 서명 검증은 벤치가 진짜 파일로 한다
function fakePe(opts: { is64?: boolean; bodyBytes?: number; tableBytes?: number } = {}): Buffer {
  const { is64 = false, bodyBytes = 512, tableBytes = 0 } = opts
  const pe = 0x80
  const headers = Buffer.alloc(0x200)
  headers.writeUInt16LE(0x5a4d, 0)
  headers.writeUInt32LE(pe, 0x3c)
  headers.writeUInt32LE(0x00004550, pe)
  headers.writeUInt16LE(is64 ? 0x20b : 0x10b, pe + 24)
  const body = Buffer.alloc(bodyBytes, 0xab)
  const table = Buffer.alloc(tableBytes, 0xcd)
  if (tableBytes) {
    table.writeUInt32LE(tableBytes, 0)
    table.writeUInt16LE(0x0200, 4)
    table.writeUInt16LE(0x0002, 6)
    const dir = pe + 24 + (is64 ? 112 : 96) + 32
    headers.writeUInt32LE(headers.length + body.length, dir)
    headers.writeUInt32LE(tableBytes, dir + 4)
  }
  return Buffer.concat([headers, body, table])
}

describe('PE에서 해시 밖에 있는 곳', () => {
  it('PE32와 PE32+는 Certificate Table 항목의 위치가 16바이트 다르다', () => {
    const a = parsePe(fakePe())
    const b = parsePe(fakePe({ is64: true }))
    expect(a.checksumOffset).toBe(b.checksumOffset)
    expect(b.certDirOffset - a.certDirOffset).toBe(16)
  })
  it('서명이 없으면 체크섬 4바이트와 디렉터리 항목 8바이트만 빠진다', () => {
    const pe = fakePe()
    expect(parsePe(pe).certTable).toBeNull()
    expect(excludedBytes(pe)).toBe(12)
  })
  it('서명이 있으면 Certificate Table만큼 더 빠진다', () => {
    expect(excludedBytes(fakePe({ tableBytes: 64 }))).toBe(12 + 64)
  })
  it('MZ로 시작하지 않으면 거절한다', () => {
    expect(() => parsePe(Buffer.alloc(100))).toThrow('MZ')
  })
  it('파일 밖을 가리키는 Certificate Table은 거절한다', () => {
    const pe = fakePe({ tableBytes: 64 })
    expect(() => parsePe(pe.subarray(0, pe.length - 8))).toThrow('파일 밖')
  })
})

describe('무엇을 바꾸면 해시가 바뀌는가', () => {
  const pe = fakePe({ tableBytes: 64 })
  const digest = authenticodeDigest(pe)

  it('본문을 한 비트 바꾸면 바뀐다', () => {
    expect(authenticodeDigest(flipBit(pe, 0x210)).equals(digest)).toBe(false)
  })
  it('헤더를 한 비트 바꿔도 바뀐다', () => {
    expect(authenticodeDigest(flipBit(pe, 0x90)).equals(digest)).toBe(false)
  })
  it('체크섬을 바꿔도 안 바뀐다', () => {
    expect(authenticodeDigest(setChecksum(pe, 0xdeadbeef)).equals(digest)).toBe(true)
  })
  it('Certificate Table 뒤에 덧붙이면 바뀐다', () => {
    expect(authenticodeDigest(appendAfterTable(pe, Buffer.from('payload'))).equals(digest)).toBe(false)
  })
  it('Certificate Table을 늘려서 그 안에 넣으면 안 바뀐다', () => {
    const padded = padInsideTable(pe, Buffer.from('payload'))
    expect(padded.length).toBe(pe.length + 8)
    expect(authenticodeDigest(padded).equals(digest)).toBe(true)
  })
  it('해시 구간은 서로 겹치지 않고 순서대로다', () => {
    const ranges = hashedRanges(pe)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBeGreaterThan(ranges[i - 1]![1])
  })
})

describe('DER 읽기', () => {
  it('OID를 점 표기로 푼다', () => {
    // 1.3.6.1.4.1.311.2.1.4 (SPC_INDIRECT_DATA)
    expect(oid(readDer(Buffer.from('060a2b060104018237020104', 'hex')))).toBe('1.3.6.1.4.1.311.2.1.4')
  })
  it('긴 길이(0x82)와 안에 든 것을 읽는다', () => {
    const inner = Buffer.concat([Buffer.from([0x04, 0x82, 0x01, 0x00]), Buffer.alloc(256, 7)])
    const seq = Buffer.concat([Buffer.from([0x30, 0x82, (inner.length >> 8) & 0xff, inner.length & 0xff]), inner])
    const node = readDer(seq)
    expect(node.children).toHaveLength(1)
    expect(node.children[0]!.body.length).toBe(256)
  })
  it('잘린 DER는 거절한다', () => {
    expect(() => readDer(Buffer.from([0x30, 0x05, 0x01]))).toThrow('잘렸다')
  })
})
