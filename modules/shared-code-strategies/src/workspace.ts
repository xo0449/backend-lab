import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export interface Step {
  cwd: string
  cmd: string
}

/**
 * 명령을 실행하면서 몇 번 실행했는지 센다.
 *
 * 이 실험이 재려는 것은 "공통 로직을 고친 뒤 각 서비스가 새 동작을
 * 갖기까지 사람이 무엇을 해야 하는가"다. 그 무엇을 명령 수로 센다.
 */
export class Workspace {
  readonly root: string
  readonly steps: Step[] = []
  private counting = false

  constructor(prefix: string) {
    this.root = mkdtempSync(join(tmpdir(), `lab-${prefix}-`))
  }

  path(...parts: string[]) {
    return join(this.root, ...parts)
  }

  dir(...parts: string[]) {
    const p = this.path(...parts)
    mkdirSync(p, { recursive: true })
    return p
  }

  write(rel: string, content: string) {
    const p = this.path(rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content)
  }

  read(rel: string) {
    return readFileSync(this.path(rel), 'utf8')
  }

  exists(rel: string) {
    return existsSync(this.path(rel))
  }

  /** 준비 단계. 여기서 실행한 명령은 세지 않는다. */
  setup<T>(fn: () => T): T {
    this.counting = false
    return fn()
  }

  /** 측정 단계. 여기서 실행한 명령만 센다. */
  measure<T>(fn: () => T): T {
    this.steps.length = 0
    this.counting = true
    try {
      return fn()
    } finally {
      this.counting = false
    }
  }

  run(cwd: string, cmd: string, args: string[]): string {
    if (this.counting) this.steps.push({ cwd, cmd: `${cmd} ${args.join(' ')}` })
    // 윈도우에서 npm은 npm.cmd라서 셸 없이는 ENOENT가 난다. 세는 단계 이름은 그대로 둔다.
    const winNpm = process.platform === 'win32' && cmd === 'npm'
    return execFileSync(winNpm ? 'npm.cmd' : cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: winNpm,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
  }

  git(cwd: string, ...args: string[]) {
    return this.run(cwd, 'git', args)
  }

  /** 커밋까지 한 번에. git add와 commit을 한 단계로 센다. */
  commit(cwd: string, message: string) {
    this.git(cwd, 'add', '-A')
    this.run(cwd, 'git', [
      '-c', 'user.email=lab@example.com',
      '-c', 'user.name=lab',
      'commit', '-q', '-m', message,
    ])
  }

  initRepo(cwd: string) {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd })
    execFileSync('git', ['config', 'user.email', 'lab@example.com'], { cwd })
    execFileSync('git', ['config', 'user.name', 'lab'], { cwd })
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd })
    execFileSync('git', ['config', 'protocol.file.allow', 'always'], { cwd })
  }

  cleanup() {
    rmSync(this.root, { recursive: true, force: true })
  }
}

/** 두 서비스가 쓰는 공통 로직. 할인 계산 한 줄이면 충분하다. */
export const DISCOUNT_V1 = `export function discount(price) {
  return Math.floor(price * 0.1)
}
`

/** 버그 수정. 상한을 넣는다. 동작이 바뀌지만 시그니처는 그대로다. */
export const DISCOUNT_V2 = `export function discount(price) {
  return Math.min(Math.floor(price * 0.1), 5000)
}
`

/** 호환을 깨는 변경. 인자가 하나 늘었다. */
export const DISCOUNT_V3 = `export function discount(price, rate) {
  return Math.min(Math.floor(price * rate), 5000)
}
`

export const SERVICE_MAIN = (importPath: string) => `import { discount } from '${importPath}'
console.log(discount(100000))
`
