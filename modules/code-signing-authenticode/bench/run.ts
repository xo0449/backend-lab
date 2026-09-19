import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authenticodeDigest, excludedBytes, hashedRanges, parsePe } from '../src/pe'
import { inspect } from '../src/signature'
import { appendAfterTable, flipBit, padInsideTable, setChecksum } from '../src/tamper'

// 서명된 진짜 실행 파일 하나를 받아서, 서명이 무엇을 지키고 무엇을 안 지키는지 고쳐 가며 본다.
//
//   FILE=경로      받지 않고 이 파일을 쓴다 (서명 없는 파일도 된다. 1번만 돈다)
//   FLIPS=2000     3번에서 뒤집어 볼 비트 수
//   SEED=1         뒤집을 자리를 고르는 씨앗
//   ONLY=n         시나리오 하나만
//   OUT=폴더       4번에서 고친 파일들을 이 폴더에 쓴다. Windows로 가져가 Get-AuthenticodeSignature로 볼 때

// Microsoft가 서명해서 배포하는 WebView2 설치 부트스트래퍼. 1.8MB. 파일은 때때로 새 버전으로 바뀐다
const SAMPLE_URL = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'
const FLIPS = Number(process.env.FLIPS ?? 2000)
const ONLY = process.env.ONLY ? Number(process.env.ONLY) : null

async function sample(): Promise<{ path: string; buf: Buffer }> {
  if (process.env.FILE) return { path: process.env.FILE, buf: readFileSync(process.env.FILE) }
  const path = join(tmpdir(), 'lab-signing-sample.exe')
  if (!existsSync(path)) {
    const res = await fetch(SAMPLE_URL)
    if (!res.ok) throw new Error(`표본을 못 받았다: ${res.status}`)
    writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  }
  return { path, buf: readFileSync(path) }
}

// 씨앗이 같으면 같은 자리를 고른다
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 2 ** 32)
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const yes = (b: boolean): string => (b ? '통과' : '실패')

function verdict(buf: Buffer): string {
  const r = inspect(buf)
  if (!r) return '서명 없음'
  return `파일 해시 ${yes(r.fileMatches)} · 내용 해시 ${yes(r.contentMatches)} · 서명 값 ${yes(r.signatureValid)}`
}

const { path, buf } = await sample()
const layout = parsePe(buf)
const run = (n: number): boolean => ONLY === null || ONLY === n

if (run(1)) {
  console.log('\n[1] 있는 그대로')
  console.log(`  파일            ${path}`)
  console.log(`  크기            ${buf.length.toLocaleString()} 바이트 · ${layout.is64 ? 'PE32+' : 'PE32'}`)
  console.log(`  파일 SHA-256    ${sha256(buf)}`)
  console.log(`  해시 밖         ${excludedBytes(buf).toLocaleString()} 바이트 (체크섬 4 + 디렉터리 항목 8 + Certificate Table ${layout.certTable?.size.toLocaleString() ?? 0})`)
  console.log(`  해시 구간       ${hashedRanges(buf).map(([a, b]) => `[${a}, ${b})`).join(' ')}`)
  const r = inspect(buf)
  if (!r) console.log('  서명            없음. Certificate Table 항목이 0, 0이다')
  else {
    console.log(`  서명 크기       ${r.pkcs7Bytes.toLocaleString()} 바이트 (PKCS#7) · ${r.algorithm}`)
    console.log(`  서명 속 해시    ${r.claimedDigest.toString('hex')}`)
    console.log(`  다시 계산       ${r.actualDigest.toString('hex')}`)
    console.log(`  판정            ${verdict(buf)}`)
    console.log(`  서명자          ${r.signer?.subject} (${r.signer?.validFrom} ~ ${r.signer?.validTo})`)
    for (const c of r.certificates) console.log(`  들어 있는 인증서 ${c.subject}  ←  ${c.issuer}`)
    console.log(`  타임스탬프      ${r.timestamp ?? '없음'}`)
  }
}

if (layout.certTable) {
  if (run(2)) {
    console.log('\n[2] 해시 계산에 걸리는 시간')
    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      const t = process.hrtime.bigint()
      authenticodeDigest(buf)
      times.push(Number(process.hrtime.bigint() - t) / 1e6)
    }
    times.sort((a, b) => a - b)
    console.log(`  50번 중앙값 ${times[25]!.toFixed(2)}ms · 최대 ${times[49]!.toFixed(2)}ms`)
  }

  if (run(3)) {
    console.log(`\n[3] 해시 구간 안에서 비트 하나 뒤집기 × ${FLIPS}`)
    const next = rng(Number(process.env.SEED ?? 1))
    const ranges = hashedRanges(buf)
    const total = ranges.reduce((n, [a, b]) => n + b - a, 0)
    const original = authenticodeDigest(buf)
    let caught = 0
    for (let i = 0; i < FLIPS; i++) {
      let k = Math.floor(next() * total)
      let at = 0
      for (const [a, b] of ranges) {
        if (k < b - a) {
          at = a + k
          break
        }
        k -= b - a
      }
      if (!authenticodeDigest(flipBit(buf, at)).equals(original)) caught++
    }
    console.log(`  잡힘 ${caught} / ${FLIPS}`)
  }

  if (run(4)) {
    console.log('\n[4] 해시 밖을 고치기')
    const cases: [string, Buffer][] = [
      ['체크섬을 0xDEADBEEF로', setChecksum(buf, 0xdeadbeef)],
      ['파일 끝에 1KB 덧붙이기 (표 크기 그대로)', appendAfterTable(buf, Buffer.alloc(1024, 0x41))],
      ['Certificate Table을 1KB 늘려 그 안에 넣기', padInsideTable(buf, Buffer.alloc(1024, 0x41))],
      ['Certificate Table을 1MB 늘려 그 안에 넣기', padInsideTable(buf, Buffer.alloc(1024 * 1024, 0x41))],
      ['서명 값의 비트 하나 뒤집기', flipBit(buf, inspect(buf)!.signatureValueOffset + 10)],
    ]
    for (const [name, changed] of cases) {
      let result: string
      try {
        result = verdict(changed)
      } catch (e) {
        result = `읽기 실패: ${(e as Error).message}`
      }
      if (process.env.OUT) writeFileSync(join(process.env.OUT, `case${cases.findIndex((c) => c[0] === name) + 1}.exe`), changed)
      console.log(`  ${name}`)
      console.log(`    파일 SHA-256 ${sha256(changed) === sha256(buf) ? '같다' : '달라짐'} · ${result}`)
    }
  }
}
