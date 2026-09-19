// DER를 읽는 데 필요한 만큼만. 서명(PKCS#7 SignedData)을 걸어 다니려고 만들었다. 쓰기는 없다.

export interface Node {
  tag: number
  /** 태그와 길이를 포함한 전체 */
  raw: Buffer
  /** 내용만 */
  body: Buffer
  children: Node[]
}

export function readDer(buf: Buffer, start = 0): Node {
  const tag = buf[start]!
  let len = buf[start + 1]!
  let head = 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) throw new Error('지원하지 않는 DER 길이')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[start + 2 + i]!
    head = 2 + n
  }
  const body = buf.subarray(start + head, start + head + len)
  if (body.length !== len) throw new Error('DER가 잘렸다')
  const node: Node = { tag, raw: buf.subarray(start, start + head + len), body, children: [] }
  // 0x20 비트가 서 있으면 안에 또 DER가 들어 있다
  if (tag & 0x20) {
    let at = 0
    while (at < body.length) {
      const child = readDer(body, at)
      node.children.push(child)
      at += child.raw.length
    }
  }
  return node
}

export function oid(node: Node): string {
  if (node.tag !== 0x06) throw new Error('OID가 아니다')
  const b = node.body
  const parts = [Math.floor(b[0]! / 40), b[0]! % 40]
  let v = 0
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i]! & 0x7f)
    if (!(b[i]! & 0x80)) {
      parts.push(v)
      v = 0
    }
  }
  return parts.join('.')
}
