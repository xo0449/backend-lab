import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { assertValidMeta, type ModuleMeta } from '../../shared/module-meta'

const MODULES_DIR = join(process.cwd(), '..', 'modules')

export interface LabModule {
  meta: ModuleMeta
  readme: string
}

/**
 * modules/ 아래의 폴더를 읽어 목록을 만든다.
 * 등록 절차는 없다. 폴더를 추가하면 여기 나타난다.
 *
 * 검증에 실패하면 예외를 던져 빌드를 멈춘다.
 * "모든 모듈은 고민을 기록한다"는 규칙을 문서가 아니라 빌드가 강제한다.
 */
export function loadModules(): LabModule[] {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(MODULES_DIR, e.name))
    .filter((dir) => existsSync(join(dir, 'meta.json')))
    .map((dir) => {
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as ModuleMeta
      assertValidMeta(meta)
      const readmePath = join(dir, 'README.md')
      const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : ''
      return { meta, readme }
    })
    .sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
}

export function loadModule(slug: string): LabModule | undefined {
  return loadModules().find((m) => m.meta.slug === slug)
}
