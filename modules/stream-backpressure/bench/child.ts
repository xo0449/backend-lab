/**
 * 힙 상한을 낮춰 걸고 한 판만 돌린다. 부모가 `--max-old-space-size`를 붙여 띄운다.
 * 터지는 것을 직접 보려면 이 방법밖에 없다. 같은 프로세스 안에서는 못 잰다.
 */
import { ensureCsv } from '../src/csv.js'
import { runLoad, type Mode } from '../src/load.js'

const mode = process.argv[2] as Mode
const rows = Number(process.argv[3])
const batch = Number(process.argv[4] ?? 100)
const msPerBatch = Number(process.argv[5] ?? 1)

const { path } = await ensureCsv(rows)
const r = await runLoad(mode, { path, label: mode, batch, msPerBatch })
process.stdout.write(`OK ${JSON.stringify(r)}\n`)
