import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const fixtures = join(here, '..', 'fixtures')
const dist = join(here, '..', 'dist')

/**
 * 케이스를 어떻게 돌릴 것인가.
 *
 *   tsc  NestJS 프로젝트의 기본값. CommonJS로 빌드하고 데코레이터 메타데이터를 내보낸다
 *   tsx  이 저장소가 벤치를 돌리는 방식. ESM이고 esbuild라 메타데이터가 없다
 */
export type Runtime = 'tsc' | 'tsx'

export interface Outcome {
  /** 어디서 멈췄는가. ok는 끝까지 갔다는 뜻이다 */
  stage: 'import' | 'boot' | 'call' | 'ok' | 'crash'
  message?: string
  result?: unknown
}

/**
 * fixtures/를 통째로 CommonJS로 빌드한다. 한 번만 하면 된다.
 *
 * npm이나 npx를 거치지 않고 node로 tsc를 직접 부른다.
 * 윈도우에서 `npm`을 spawn하면 ENOENT가 나는 걸 shared-code-strategies에서 겪었다.
 */
export function build(): void {
  rmSync(dist, { recursive: true, force: true })
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  const r = spawnSync(process.execPath, [tsc, '-p', join(fixtures, 'tsconfig.json')], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`fixtures 빌드 실패\n${r.stdout}${r.stderr}`)
  // 루트 package.json이 "type": "module"이라 이게 없으면 빌드 결과를 ESM으로 읽는다
  writeFileSync(join(dist, 'package.json'), '{"type":"commonjs"}\n')
}

export interface RunOptions {
  runtime?: Runtime
  /** 이 파일을 먼저 읽힌다. app.ts의 import 순서를 바꾼 것과 같다. 예: 'b.service' */
  first?: string
}

export function run(name: string, o: RunOptions = {}): Outcome {
  const runtime = o.runtime ?? 'tsc'
  const extra = o.first ? [o.first] : []
  const r =
    runtime === 'tsc'
      ? spawnSync(process.execPath, ['runner.js', name, ...extra], { cwd: dist, encoding: 'utf8', timeout: 20_000 })
      : spawnSync(process.execPath, [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'runner.ts', name, ...extra], {
          cwd: fixtures,
          encoding: 'utf8',
          timeout: 20_000,
        })

  const line = r.stdout.split('\n').find((l) => l.startsWith('@@'))
  if (!line) return { stage: 'crash', message: (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') }
  return JSON.parse(line.slice(2)) as Outcome
}

/** 에러 메시지의 첫 줄 */
export function headline(o: Outcome): string {
  return (o.message ?? '').split('\n')[0]
}

/** 메시지가 순환을 의심하라고 말해주는가 */
export function mentionsCycle(o: Outcome): boolean {
  return /circular|forwardRef/i.test(o.message ?? '')
}

/** 메시지가 `import type`을 의심하라고 말하는가 */
export function blamesImportType(o: Outcome): boolean {
  return /import type/.test(o.message ?? '')
}

/** 메시지가 이름을 댄 클래스. "dependencies of the BService", "create the BModule instance" */
export function blamed(o: Outcome): string | null {
  const m = /(?:dependencies of the|cannot create the) (\w+)/i.exec(o.message ?? '')
  return m ? m[1] : null
}
