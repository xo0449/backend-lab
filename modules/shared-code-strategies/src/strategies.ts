import { execFileSync } from 'node:child_process'
import { Workspace, DISCOUNT_V1, SERVICE_MAIN } from './workspace.js'

export interface Strategy {
  name: string
  /** 두 서비스와 공통 로직을 만든다. 준비 단계는 세지 않는다. */
  setup(ws: Workspace): void
  /** 공통 로직을 새 내용으로 바꾸고 두 서비스에 반영한다. 이 단계를 센다. */
  propagate(ws: Workspace, next: string): void
  /** 공통 쪽만 고친다. 서비스는 아무것도 하지 않는다. */
  changeSharedOnly(ws: Workspace, next: string): void
  /** 한 서비스만 새 버전을 받는다. 불가능하면 false를 반환한다. */
  adoptOne(ws: Workspace, service: string): boolean
  /** 서비스가 지금 계산하는 값. 반영됐는지 확인하는 데 쓴다. */
  runService(ws: Workspace, service: string): string
  /** 서비스마다 다른 버전을 쓸 수 있는가. */
  allowsSkew: boolean
}

function nodeRun(ws: Workspace, dir: string, file = 'main.mjs') {
  return execFileSync('node', [file], { cwd: dir, encoding: 'utf8' }).trim()
}

/**
 * npm을 부른다. 윈도우에서 npm은 실행 파일이 아니라 npm.cmd라서
 * 셸 없이 execFileSync로 부르면 ENOENT가 난다.
 */
function npmRun(args: string[], cwd: string) {
  const win = process.platform === 'win32'
  return execFileSync(win ? 'npm.cmd' : 'npm', args, { cwd, shell: win })
}

/**
 * A. 복사해서 붙인다.
 *
 * 공유 장치가 없다. 각 서비스가 자기 사본을 갖는다.
 * 비교의 바닥선으로 둔다.
 */
export const copyPaste: Strategy = {
  name: '복사',
  allowsSkew: true,
  setup(ws) {
    ws.setup(() => {
      for (const s of ['service-a', 'service-b']) {
        const dir = ws.dir(s)
        ws.write(`${s}/discount.mjs`, DISCOUNT_V1)
        ws.write(`${s}/main.mjs`, SERVICE_MAIN('./discount.mjs'))
        ws.initRepo(dir)
        ws.commit(dir, 'init')
      }
    })
  },
  propagate(ws, next) {
    // 서비스마다 파일을 직접 고친다. 공통 저장소가 없다.
    for (const s of ['service-a', 'service-b']) {
      ws.run(ws.path(s), 'sh', ['-c', `cat > discount.mjs <<'EOF'\n${next}EOF`])
      ws.commit(ws.path(s), 'fix discount')
    }
  },
  changeSharedOnly() {
    // 공통 저장소가 없다. 고칠 곳이 각 서비스 안이라 이 개념이 없다.
  },
  adoptOne() {
    return false
  },
  runService: (ws, s) => nodeRun(ws, ws.path(s)),
}

/**
 * B. 깃 서브모듈로 소스를 공유한다.
 *
 * 서비스가 공통 저장소의 특정 커밋을 가리킨다.
 * 가리키는 커밋을 옮기는 것도 서비스 쪽 커밋이다.
 */
export const submodule: Strategy = {
  name: '서브모듈',
  allowsSkew: true,
  setup(ws) {
    ws.setup(() => {
      const shared = ws.dir('shared')
      ws.write('shared/discount.mjs', DISCOUNT_V1)
      ws.initRepo(shared)
      ws.commit(shared, 'init')

      for (const s of ['service-a', 'service-b']) {
        const dir = ws.dir(s)
        ws.initRepo(dir)
        ws.write(`${s}/main.mjs`, SERVICE_MAIN('./shared/discount.mjs'))
        ws.commit(dir, 'init')
        ws.git(dir, '-c', 'protocol.file.allow=always',
          'submodule', 'add', '-q', ws.path('shared'), 'shared')
        ws.commit(dir, 'add shared submodule')
      }
    })
  },
  propagate(ws, next) {
    const shared = ws.path('shared')
    ws.run(shared, 'sh', ['-c', `cat > discount.mjs <<'EOF'\n${next}EOF`])
    ws.commit(shared, 'fix discount')

    // 서비스마다 서브모듈을 당기고, 가리키는 커밋을 옮기는 커밋을 또 만든다.
    for (const s of ['service-a', 'service-b']) {
      const dir = ws.path(s)
      ws.git(dir, '-C', 'shared', 'pull', '-q', 'origin', 'main')
      ws.commit(dir, 'bump shared')
    }
  },
  changeSharedOnly(ws, next) {
    const shared = ws.path('shared')
    ws.run(shared, 'sh', ['-c', `cat > discount.mjs <<'EOF'\n${next}EOF`])
    ws.commit(shared, 'fix discount')
  },
  adoptOne(ws, service) {
    const dir = ws.path(service)
    ws.git(dir, '-C', 'shared', 'pull', '-q', 'origin', 'main')
    ws.commit(dir, 'bump shared')
    return true
  },
  runService: (ws, s) => nodeRun(ws, ws.path(s)),
}

/**
 * C. 패키지로 배포한다.
 *
 * 공통 로직을 tarball로 만들어 각 서비스가 설치한다.
 * 사내 레지스트리를 쓰는 경우와 절차가 같다.
 */
export const packaged: Strategy = {
  name: '패키지',
  allowsSkew: true,
  setup(ws) {
    ws.setup(() => {
      const pkg = ws.dir('shared-pkg')
      ws.write('shared-pkg/package.json', JSON.stringify({
        name: 'lab-discount', version: '1.0.0', type: 'module', main: 'discount.mjs',
        files: ['discount.mjs'],
      }, null, 2))
      ws.write('shared-pkg/discount.mjs', DISCOUNT_V1)
      npmRun(['pack', '--silent', '--pack-destination', ws.root], pkg)

      for (const s of ['service-a', 'service-b']) {
        const dir = ws.dir(s)
        ws.write(`${s}/package.json`, JSON.stringify({
          name: s, version: '1.0.0', type: 'module',
        }, null, 2))
        ws.write(`${s}/main.mjs`, SERVICE_MAIN('lab-discount'))
        npmRun(['install', '--silent', '--no-audit', '--no-fund',
          ws.path('lab-discount-1.0.0.tgz')], dir)
        ws.initRepo(dir)
        ws.commit(dir, 'init')
      }
    })
  },
  propagate(ws, next) {
    const pkg = ws.path('shared-pkg')
    ws.run(pkg, 'sh', ['-c', `cat > discount.mjs <<'EOF'\n${next}EOF`])
    ws.run(pkg, 'npm', ['version', '--no-git-tag-version', 'patch'])
    ws.run(pkg, 'npm', ['pack', '--silent', '--pack-destination', ws.root])

    for (const s of ['service-a', 'service-b']) {
      const dir = ws.path(s)
      ws.run(dir, 'npm', ['install', '--silent', '--no-audit', '--no-fund',
        ws.path('lab-discount-1.0.1.tgz')])
      ws.commit(dir, 'bump lab-discount')
    }
  },
  changeSharedOnly(ws, next) {
    const pkg = ws.path('shared-pkg')
    ws.run(pkg, 'sh', ['-c', `cat > discount.mjs <<'EOF'\n${next}EOF`])
    ws.run(pkg, 'npm', ['version', '--no-git-tag-version', 'patch'])
    ws.run(pkg, 'npm', ['pack', '--silent', '--pack-destination', ws.root])
  },
  adoptOne(ws, service) {
    const dir = ws.path(service)
    ws.run(dir, 'npm', ['install', '--silent', '--no-audit', '--no-fund',
      ws.path('lab-discount-1.0.1.tgz')])
    ws.commit(dir, 'bump lab-discount')
    return true
  },
  runService: (ws, s) => nodeRun(ws, ws.path(s)),
}

/**
 * D. 모노레포 워크스페이스.
 *
 * 공통 로직과 서비스가 한 저장소에 있다.
 * 설치 시점에 심볼릭 링크로 연결되므로 고치면 바로 반영된다.
 */
export const monorepo: Strategy = {
  name: '모노레포',
  allowsSkew: false,
  setup(ws) {
    ws.setup(() => {
      const root = ws.dir('repo')
      ws.write('repo/package.json', JSON.stringify({
        name: 'repo', private: true, type: 'module',
        workspaces: ['packages/*', 'services/*'],
      }, null, 2))
      ws.write('repo/packages/discount/package.json', JSON.stringify({
        name: 'lab-discount', version: '1.0.0', type: 'module', main: 'discount.mjs',
      }, null, 2))
      ws.write('repo/packages/discount/discount.mjs', DISCOUNT_V1)

      for (const s of ['service-a', 'service-b']) {
        ws.write(`repo/services/${s}/package.json`, JSON.stringify({
          name: s, version: '1.0.0', type: 'module',
          dependencies: { 'lab-discount': '1.0.0' },
        }, null, 2))
        ws.write(`repo/services/${s}/main.mjs`, SERVICE_MAIN('lab-discount'))
      }
      npmRun(['install', '--silent', '--no-audit', '--no-fund'], root)
      ws.initRepo(root)
      ws.commit(root, 'init')
    })
  },
  propagate(ws, next) {
    const root = ws.path('repo')
    ws.run(root, 'sh', ['-c', `cat > packages/discount/discount.mjs <<'EOF'\n${next}EOF`])
    ws.commit(root, 'fix discount')
  },
  changeSharedOnly(ws, next) {
    // 소스가 하나다. 공통만 고친다는 것이 곧 전부 고치는 것이다.
    const root = ws.path('repo')
    ws.run(root, 'sh', ['-c', `cat > packages/discount/discount.mjs <<'EOF'\n${next}EOF`])
    ws.commit(root, 'fix discount')
  },
  adoptOne() {
    // 한 서비스만 옛 버전에 두는 방법이 없다.
    return false
  },
  runService: (ws, s) => nodeRun(ws, ws.path('repo', 'services', s)),
}

export const STRATEGIES = [copyPaste, submodule, packaged, monorepo]
