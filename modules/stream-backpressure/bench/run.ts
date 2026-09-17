import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { ensureCsv } from '../src/csv.js'
import { runLoad } from '../src/load.js'
import { canForceGc, line, mb } from '../src/memory.js'
import { FailingSink, lineSplitter, rowParser } from '../src/sink.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..')

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0
const ROWS = Number(process.env.ROWS ?? 1000000)
const HEAP = Number(process.env.HEAP ?? 192)
const BATCH = Number(process.env.BATCH ?? 100)
const MS_PER_BATCH = Number(process.env.MS_PER_BATCH ?? 1)

const base = { batch: BATCH, msPerBatch: MS_PER_BATCH }

const { path, bytes } = await ensureCsv(ROWS)
console.log(`\n${ROWS.toLocaleString()}건 CSV · ${mb(bytes)}`)
console.log(`${path}`)
console.log(`적재처는 ${BATCH}건마다 ${MS_PER_BATCH}ms 걸린다. 그 사이 이벤트 루프를 한 번 돌려준다`)
if (!canForceGc) {
  console.log(`\n  경고: --expose-gc 없이 돌고 있습니다. 힙 숫자가 안 치운 쓰레기까지 셉니다.`)
  console.log(`        npm run lab:stream 으로 돌리면 플래그가 붙습니다.`)
}
console.log('')

if (ONLY === 0 || ONLY === 1) await scenarioIgnoreOrNot()
if (ONLY === 0 || ONLY === 2) await scenarioWhatSetsTheLag()
if (ONLY === 0 || ONLY === 3) await scenarioWhereItDies()
if (ONLY === 0 || ONLY === 4) await scenarioPipeVsPipeline()
if (ONLY === 0 || ONLY === 5) await scenarioHighWaterMark()

/**
 * 1. write()의 반환값을 안 보면 무엇이 달라지는가.
 */
async function scenarioIgnoreOrNot() {
  console.log(`[1] write()의 반환값을 볼 것인가\n`)

  const ignore = await runLoad('ignore', { ...base, path, label: '반환값을 안 본다' })
  console.log(line(ignore))
  console.log(line(await runLoad('drain', { ...base, path, label: 'drain을 기다린다' }), ignore))
  console.log(line(await runLoad('pipeline', { ...base, path, label: 'pipeline()으로 잇는다' }), ignore))

  console.log(`\n    셋 다 같은 파일을 같은 적재처에 같은 건수만큼 넣었다.`)
  console.log(`    다른 건 적재처가 "그만"이라고 할 때 앞쪽이 멈추느냐뿐이다.`)
}

/**
 * 2. 뒤처지는 양은 무엇이 정하는가. 파일 크기가 아니다.
 */
async function scenarioWhatSetsTheLag() {
  console.log(`\n[2] 얼마나 쌓이는지는 무엇이 정하는가\n`)

  console.log(`  적재처가 한 번에 삼키는 건수를 바꿔본다 (반환값을 안 보는 쪽)`)
  for (const batch of [100, 500, 1000, 4000]) {
    const r = await runLoad('ignore', {
      path, batch, msPerBatch: MS_PER_BATCH, label: `${batch}건씩 삼킴`,
    })
    console.log(line(r))
  }

  console.log(`\n  같은 조건에서 pipeline()으로 이으면`)
  for (const batch of [100, 4000]) {
    const r = await runLoad('pipeline', {
      path, batch, msPerBatch: MS_PER_BATCH, label: `${batch}건씩 삼킴`,
    })
    console.log(line(r))
  }

  console.log(`\n    앞이 한 번에 내놓는 양과 뒤가 한 번에 삼키는 양의 비가 정한다.`)
  console.log(`    파일이 10배 커지면 쌓이는 것도 10배다. 상한이 없다.`)
}

/**
 * 3. 그래서 언제 터지는가. 힙 상한을 걸고 건수를 올려본다.
 */
async function scenarioWhereItDies() {
  console.log(`\n[3] 힙 상한 ${HEAP}MB에서 몇 건까지 버티는가\n`)

  const steps = [100000, 250000, 500000, 1000000].filter((n) => n <= ROWS)
  for (const n of steps) {
    const r = await runInChild('ignore', n, HEAP)
    console.log(`     반환값을 안 본다  ${String(n).padStart(9)}건  ${r}`)
    if (r.startsWith('죽음')) break
  }
  for (const n of steps) {
    console.log(`     pipeline()       ${String(n).padStart(9)}건  ${await runInChild('pipeline', n, HEAP)}`)
  }

  console.log(`\n    같은 파일, 같은 상한, 같은 적재처다. 이어붙이는 방식만 다르다.`)
}

/**
 * 4. 적재처가 터졌을 때 앞쪽 스트림은 어떻게 되는가.
 */
async function scenarioPipeVsPipeline() {
  console.log(`\n[4] 적재처가 터졌을 때 앞쪽은 닫히는가\n`)

  const N = 200
  const gc = (globalThis as { gc?: () => void }).gc
  // RSS는 한 번 오르면 잘 안 내려온다. OS가 페이지를 안 돌려주기 때문이다.
  // 새어나간 스트림이 붙잡고 있는 양을 보려면 힙과 버퍼(external)를 봐야 한다.
  const settle = () => {
    gc?.()
    const m = process.memoryUsage()
    return m.heapUsed + m.external
  }

  const before = settle()
  const kept: { src: Readable; mid: Readable[] }[] = []
  let pipeErrors = 0
  for (let i = 0; i < N; i++) {
    const src = createReadStream(path, { highWaterMark: 64 * 1024 })
    const split = lineSplitter()
    const parse = rowParser()
    const dest = new FailingSink(500)
    // 에러 핸들러를 적재처에만 단다. pipe()는 에러를 옆으로 넘겨주지 않으므로
    // 사슬의 스트림마다 따로 달아야 한다. 안 달면 프로세스가 내려간다.
    src.pipe(split).pipe(parse).pipe(dest)
    await new Promise<void>((r) => dest.once('error', () => { pipeErrors++; r() }))
    kept.push({ src, mid: [split, parse] })
  }
  const aliveSrc = kept.filter((k) => !k.src.destroyed).length
  const aliveMid = kept.reduce((s, k) => s + k.mid.filter((m) => !m.destroyed).length, 0)
  const withLeaks = settle()

  for (const k of kept) { k.src.destroy(); for (const m of k.mid) m.destroy() }
  kept.length = 0
  await new Promise((r) => setTimeout(r, 200))
  const afterCleanup = settle()

  const kept2: { src: Readable; mid: Readable[] }[] = []
  let pipelineErrors = 0
  for (let i = 0; i < N; i++) {
    const src = createReadStream(path, { highWaterMark: 64 * 1024 })
    const split = lineSplitter()
    const parse = rowParser()
    try {
      await pipeline(src, split, parse, new FailingSink(500))
    } catch {
      pipelineErrors++
    }
    kept2.push({ src, mid: [split, parse] })
  }
  const aliveSrc2 = kept2.filter((k) => !k.src.destroyed).length
  const aliveMid2 = kept2.reduce((s, k) => s + k.mid.filter((m) => !m.destroyed).length, 0)
  kept2.length = 0
  await new Promise((r) => setTimeout(r, 200))
  const afterPipeline = settle()

  const w = (n: number) => String(n).padStart(3)
  console.log(`     시작                                                     힙+버퍼 ${mb(before).padStart(7)}`)
  console.log(`     pipe()      에러 ${pipeErrors}/${N}건 받음  안 닫힌 것 읽기 ${w(aliveSrc)}개 · 중간 ${w(aliveMid)}개  힙+버퍼 ${mb(withLeaks).padStart(7)}`)
  console.log(`       ㄴ 손으로 전부 destroy() 하고 참조를 버린 뒤              힙+버퍼 ${mb(afterCleanup).padStart(7)}`)
  console.log(`     pipeline()  에러 ${pipelineErrors}/${N}건 받음  안 닫힌 것 읽기 ${w(aliveSrc2)}개 · 중간 ${w(aliveMid2)}개  힙+버퍼 ${mb(afterPipeline).padStart(7)}`)
  console.log(`\n     열린 파일 디스크립터를 프로세스 안에서 세는 방법은 못 찾았다.`)
  console.log(`     getActiveResourcesInfo()는 종류만 알려주고 개수를 안 나눠준다.`)
  console.log(`     여기서 확인한 건 스트림 객체가 안 닫혔다는 것까지다.`)

  console.log(`\n    pipe()는 뒤가 터져도 앞을 안 닫는다. 파일 핸들이 그대로 남는다.`)
  console.log(`    pipeline()은 한 군데서 에러를 받고 사슬 전체를 닫는다.`)
}

/**
 * 5. highWaterMark를 올리면 무엇을 사고 무엇을 파는가.
 */
async function scenarioHighWaterMark() {
  console.log(`\n[5] highWaterMark를 올리면\n`)

  let first
  for (const hwm of [16, 1000, 50000, 500000]) {
    const r = await runLoad('pipeline', {
      ...base, path, highWaterMark: hwm, label: `hwm ${hwm}`,
    })
    first ??= r
    console.log(line(r, first))
  }

  console.log(`\n    올릴수록 뒤처짐을 더 받아준다. 받아준 만큼 힙에 앉아 있다.`)
  console.log(`    반환값을 안 보는 것은 hwm을 무한대로 둔 것과 같다.`)
}

function runInChild(mode: string, rows: number, heapMb: number): Promise<string> {
  return new Promise((done) => {
    const t0 = performance.now()
    const child = spawn(
      process.execPath,
      [
        '--import', 'tsx', '--expose-gc', `--max-old-space-size=${heapMb}`,
        join(HERE, 'child.ts'), mode, String(rows), String(BATCH), String(MS_PER_BATCH),
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    let err = ''
    child.stdout.on('data', (b) => { out += b })
    child.stderr.on('data', (b) => { err += b })
    child.on('close', (code) => {
      const secs = `${((performance.now() - t0) / 1000).toFixed(1)}초`
      if (code === 0 && out.includes('OK ')) {
        const r = JSON.parse(out.slice(out.indexOf('OK ') + 3))
        done(`살아남음  힙 최대 ${mb(r.peakHeap).padStart(8)}  버퍼 최대 ${String(r.peakQueued).padStart(9)}건  ${secs}`)
        return
      }
      const oom = /heap out of memory|Allocation failed|JavaScript heap/i.test(err)
      done(`죽음      ${oom ? '힙 부족으로 프로세스가 내려감' : `종료코드 ${code}`}${' '.repeat(oom ? 11 : 20)}  ${secs}`)
    })
  })
}
