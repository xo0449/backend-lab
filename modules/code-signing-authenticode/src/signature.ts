import { X509Certificate, createHash, createPublicKey, verify } from 'node:crypto'
import { oid, readDer, type Node } from './der'
import { authenticodeDigest, parsePe } from './pe'

// PE 안의 Authenticode 서명을 꺼내서 사슬을 끝까지 따라간다.
//
//   파일 해시 ──같은가──> SpcIndirectData 안의 해시
//   SpcIndirectData 해시 ──같은가──> 서명된 속성의 messageDigest
//   서명된 속성 ──서명자 공개키로 검증──> 서명 값
//   서명자 인증서 ──발급자──> ... ──> 루트
//
// 마지막 줄(인증서 사슬을 믿을지)은 여기서 하지 않는다. 그건 Windows의 신뢰 저장소가 정한다.

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  spcIndirectData: '1.3.6.1.4.1.311.2.1.4',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  rfc3161Timestamp: '1.3.6.1.4.1.311.3.3.1',
  legacyCounterSign: '1.2.840.113549.1.9.6',
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
} as const

const HASH: Record<string, string> = { [OID.sha1]: 'sha1', [OID.sha256]: 'sha256', [OID.sha384]: 'sha384' }

export interface SignatureReport {
  algorithm: string
  /** 서명 안에 적혀 있는 파일 해시 */
  claimedDigest: Buffer
  /** 지금 파일로 다시 계산한 해시 */
  actualDigest: Buffer
  fileMatches: boolean
  /** SpcIndirectData의 해시가 서명된 속성의 messageDigest와 같은가 */
  contentMatches: boolean
  /** 서명된 속성을 서명자 인증서의 공개키로 검증했는가 */
  signatureValid: boolean
  signer: { subject: string; issuer: string; validFrom: string; validTo: string } | null
  certificates: { subject: string; issuer: string }[]
  /** 타임스탬프(제3자가 "이 시각에 이 서명이 있었다"고 덧서명한 것)가 붙어 있는가 */
  timestamp: 'rfc3161' | 'legacy' | null
  pkcs7Bytes: number
  /** 서명 값이 파일의 어디에 있는가. 고쳐 보는 실험에 쓴다 */
  signatureValueOffset: number
}

/** Certificate Table에서 첫 번째 PKCS#7 덩어리를 꺼낸다. 서명이 없으면 null */
export function extractPkcs7(buf: Buffer): Buffer | null {
  const { certTable } = parsePe(buf)
  if (!certTable) return null
  // WIN_CERTIFICATE: dwLength(4) wRevision(2) wCertificateType(2) bCertificate[]
  const length = buf.readUInt32LE(certTable.offset)
  const type = buf.readUInt16LE(certTable.offset + 6)
  if (type !== 0x0002) throw new Error(`PKCS#7 서명이 아니다 (type ${type})`)
  return buf.subarray(certTable.offset + 8, certTable.offset + length)
}

export function inspect(buf: Buffer): SignatureReport | null {
  const pkcs7 = extractPkcs7(buf)
  if (!pkcs7) return null

  const contentInfo = readDer(pkcs7)
  if (oid(contentInfo.children[0]!) !== OID.signedData) throw new Error('SignedData가 아니다')
  const signedData = contentInfo.children[1]!.children[0]!
  const [, , encap, ...rest] = signedData.children
  if (oid(encap!.children[0]!) !== OID.spcIndirectData) throw new Error('SpcIndirectDataContent가 아니다')

  // SpcIndirectDataContent ::= SEQUENCE { data, messageDigest DigestInfo { algorithm, digest } }
  const spc = encap!.children[1]!.children[0]!
  const digestInfo = spc.children[1]!
  const algorithm = HASH[oid(digestInfo.children[0]!.children[0]!)]
  if (!algorithm) throw new Error('모르는 해시 알고리즘')
  const claimedDigest = Buffer.from(digestInfo.children[1]!.body)
  const actualDigest = authenticodeDigest(buf, algorithm)

  const certsNode = rest.find((n) => n.tag === 0xa0)
  const certs = (certsNode?.children ?? []).filter((n) => n.tag === 0x30).map((n) => new X509Certificate(n.raw))
  const signerInfo = rest[rest.length - 1]!.children[0]!
  const signedAttrs = signerInfo.children.find((n) => n.tag === 0xa0)!
  const unsignedAttrs = signerInfo.children.find((n) => n.tag === 0xa1)
  const signatureValue = signerInfo.children.filter((n) => n.tag === 0x04).pop()!.body
  const serial = signerInfo.children[1]!.children[1]!.body.toString('hex').replace(/^0+/, '').toUpperCase()
  const signerCert = certs.find((c) => c.serialNumber.replace(/^0+/, '') === serial) ?? null

  // Authenticode는 SpcIndirectDataContent의 태그와 길이를 뺀 내용만 해시한다 (PKCS#7 v1.5의 규칙)
  const attr = (id: string): Node | undefined => signedAttrs.children.find((a) => oid(a.children[0]!) === id)
  const messageDigest = attr(OID.messageDigest)?.children[1]!.children[0]!.body
  const contentMatches = !!messageDigest && createHash(algorithm).update(spc.body).digest().equals(messageDigest)

  // 서명된 속성은 [0] IMPLICIT으로 들어 있지만 서명할 때는 SET(0x31)으로 바꿔서 해시한다 (RFC 5652 5.4)
  let signatureValid = false
  if (signerCert) {
    const asSet = Buffer.from(signedAttrs.raw)
    asSet[0] = 0x31
    signatureValid = verify(algorithm, asSet, createPublicKey(signerCert.publicKey.export({ type: 'spki', format: 'pem' })), signatureValue)
  }

  const unsignedIds = (unsignedAttrs?.children ?? []).map((a) => oid(a.children[0]!))
  const timestamp = unsignedIds.includes(OID.rfc3161Timestamp) ? 'rfc3161' : unsignedIds.includes(OID.legacyCounterSign) ? 'legacy' : null

  return {
    algorithm,
    claimedDigest,
    actualDigest,
    fileMatches: claimedDigest.equals(actualDigest),
    contentMatches,
    signatureValid,
    signer: signerCert && { subject: oneLine(signerCert.subject), issuer: oneLine(signerCert.issuer), validFrom: signerCert.validFrom, validTo: signerCert.validTo },
    certificates: certs.map((c) => ({ subject: oneLine(c.subject), issuer: oneLine(c.issuer) })),
    timestamp,
    pkcs7Bytes: pkcs7.length,
    signatureValueOffset: signatureValue.byteOffset - buf.byteOffset,
  }
}

const oneLine = (dn: string): string => dn.split('\n').filter((l) => /^(CN|O)=/.test(l)).join(', ')
