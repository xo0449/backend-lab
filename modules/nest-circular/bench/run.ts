import { build, run, headline, mentionsCycle, blamesImportType, blamed, type Outcome, type RunOptions } from '../src/harness.js'

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0

console.log(`\nfixtures/를 tsc로 빌드합니다. CommonJS, emitDecoratorMetadata. NestJS 프로젝트의 기본값입니다.`)
build()

if (ONLY === 0 || ONLY === 1) scenarioHowItBreaks()
if (ONLY === 0 || ONLY === 2) scenarioForwardRef()
if (ONLY === 0 || ONLY === 3) scenarioPlaceholder()
if (ONLY === 0 || ONLY === 4) scenarioAlternatives()
if (ONLY === 0 || ONLY === 5) scenarioTsx()

/**
 * 1. 어디서, 어떤 말로 깨지는가.
 */
function scenarioHowItBreaks() {
  console.log(`\n[1] 어디서, 어떤 말로 깨지는가\n`)

  show('01 순환 없음', '01-no-cycle')
  show('02 프로바이더 순환 · a 먼저 읽음', '02-provider-cycle')
  show('02 프로바이더 순환 · b 먼저 읽음', '02-provider-cycle', { first: 'b.service' })
  show('03 같은 순환을 한 파일에', '03-provider-cycle-same-file')
  show('04 DI 순환 없음 · 배럴로 import', '04-barrel-no-di-cycle')
  show('05 모듈 순환', '05-module-cycle')

  console.log(`\n    02는 읽는 순서를 바꾸면 에러가 이름을 대는 클래스가 바뀝니다. 고친 코드는 없습니다.`)
  console.log(`    04는 DI에 순환이 없는데 02와 같은 메시지가 나옵니다. 메시지로는 둘을 못 가립니다.`)
}

/**
 * 2. forwardRef는 무엇을 푸는가.
 */
function scenarioForwardRef() {
  console.log(`\n[2] forwardRef를 붙이면\n`)

  show('06 한쪽(A)에만 · a 먼저 읽음', '06-forwardref-one-side')
  show('06 한쪽(A)에만 · b 먼저 읽음', '06-forwardref-one-side', { first: 'b.service' })
  show('07 양쪽에 · a 먼저 읽음', '07-forwardref-both')
  show('07 양쪽에 · b 먼저 읽음', '07-forwardref-both', { first: 'b.service' })
  show('08 모듈 순환 · 양쪽에', '08-module-cycle-forwardref')

  console.log(`\n    한쪽에만 붙이면 읽는 순서에 따라 뜨기도 하고 안 뜨기도 합니다.`)
}

/**
 * 3. forwardRef가 못 푸는 것.
 */
function scenarioPlaceholder() {
  console.log(`\n[3] 양쪽에 forwardRef를 붙이고 생성자에서 상대를 바로 쓰면\n`)

  show('09 상대의 메서드를 부른다', '09-forwardref-method-in-constructor')

  for (const [label, name] of [
    ['10 상대의 필드를 읽는다 · providers [A, B]', '10-forwardref-field-in-constructor'],
    ['11 같은 코드 · providers [B, A]', '11-forwardref-field-providers-swapped'],
    ['15 생성자에서는 아무것도 안 한다 · 필드가 #private', '15-forwardref-private-field'],
  ]) {
    const o = run(name)
    console.log(`    ${label}`)
    console.log(`      멈춘 곳 ${o.stage}`)
    for (const [k, v] of Object.entries((o.result ?? {}) as Record<string, unknown>)) {
      console.log(`      ${k.padEnd(28)} ${String(v).slice(0, 90)}`)
    }
  }

  console.log(`\n    에러는 없습니다. 먼저 만들어지는 쪽의 생성자가 아직 생성자가 안 돈 상대를 받습니다.`)
  console.log(`    메서드는 프로토타입에 있어서 불립니다. 생성자에서 채우는 필드는 비어 있습니다.`)
  console.log(`    15는 부팅이 끝난 뒤에 불렀는데도 던집니다. 나중에 필드를 복사해 넣는 방식이 #private은 못 옮깁니다.`)
}

/**
 * 4. forwardRef 말고.
 */
function scenarioAlternatives() {
  console.log(`\n[4] forwardRef 말고 · 읽는 순서를 바꿔도 뜨는가\n`)

  for (const [label, name] of [
    ['07 양쪽 forwardRef', '07-forwardref-both'],
    ['12 ModuleRef로 부를 때 꺼냄', '12-alt-moduleref'],
    ['13 이벤트로 끊음', '13-alt-events'],
    ['14 같이 쓰는 부분을 셋째로 뺌', '14-alt-extract'],
  ]) {
    const aFirst = run(name)
    const bFirst = run(name, { first: 'b.service' })
    console.log(`    ${label.padEnd(24)}  a 먼저 ${aFirst.stage.padEnd(5)}  b 먼저 ${bFirst.stage.padEnd(5)}`)
  }

  console.log(`\n    ModuleRef는 DI 순환만 끊습니다. B가 A를 여전히 import하니 파일 순환은 남습니다.`)
}

/**
 * 5. 같은 케이스를 tsx로 돌리면.
 */
function scenarioTsx() {
  console.log(`\n[5] 같은 케이스를 tsx로 돌리면 (ESM, 메타데이터 없음)\n`)

  show('01 순환 없음', '01-no-cycle', { runtime: 'tsx' })
  show('02 프로바이더 순환', '02-provider-cycle', { runtime: 'tsx' })
  show('05 모듈 순환', '05-module-cycle', { runtime: 'tsx' })
  show('07 양쪽 forwardRef', '07-forwardref-both', { runtime: 'tsx' })

  console.log(`\n    순환이 없는 01과 순환이 있는 02가 같은 자리에서 같은 말로 죽습니다.`)
  console.log(`    esbuild는 생성자 타입을 안 내보냅니다. @Inject()를 명시한 07만 뜹니다.`)
}

function show(label: string, name: string, o: RunOptions = {}) {
  const r = run(name, o)
  console.log(`    ${label}`)
  console.log(`      멈춘 곳 ${r.stage}${r.stage === 'ok' ? `  ${JSON.stringify(r.result)}` : ''}`)
  if (r.stage !== 'ok') describe(r)
}

function describe(r: Outcome) {
  console.log(`      첫 줄   ${headline(r).slice(0, 110)}`)
  console.log(
    `      이름을 댄 클래스 ${blamed(r) ?? '없음'} · 순환을 의심하라고 하는가 ${mentionsCycle(r) ? '예' : '아니오'}` +
      ` · import type을 의심하라고 하는가 ${blamesImportType(r) ? '예' : '아니오'}`,
  )
}
