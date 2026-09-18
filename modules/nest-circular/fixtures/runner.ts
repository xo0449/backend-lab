import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { INestApplicationContext } from '@nestjs/common'

/**
 * 케이스 하나를 세 단계로 나눠 돌리고, 어디서 멈췄는지 한 줄로 찍는다.
 *
 *   import  파일을 읽는 단계. 데코레이터가 여기서 평가된다
 *   boot    Nest가 모듈을 훑고 인스턴스를 만드는 단계
 *   call    만들어진 서비스를 실제로 불러보는 단계
 */
interface Case {
  AppModule: new () => unknown
  probe: (app: INestApplicationContext) => unknown
}

async function main() {
  const dir = process.argv[2]
  /** 이 파일을 먼저 읽힌다. app.ts에서 import 두 줄의 순서를 바꾼 것과 같다 */
  const first = process.argv[3]
  const out = (o: object) => console.log('@@' + JSON.stringify(o))
  const brief = (e: unknown) => String((e as Error)?.message ?? e)

  let loaded: Case
  try {
    if (first) await import(`./${dir}/${first}`)
    loaded = (await import(`./${dir}/app`)) as Case
  } catch (e) {
    return out({ stage: 'import', message: brief(e) })
  }

  let app: INestApplicationContext
  try {
    app = await NestFactory.createApplicationContext(loaded.AppModule as never, {
      logger: false,
      abortOnError: false,
    })
  } catch (e) {
    return out({ stage: 'boot', message: brief(e) })
  }

  try {
    const result = await loaded.probe(app)
    out({ stage: 'ok', result })
  } catch (e) {
    out({ stage: 'call', message: brief(e) })
  }
  await app.close()
}

void main()
