import { loadModules } from '../lib/modules'
import ModuleList from './module-list'

export default function Home() {
  const modules = loadModules().map((m) => m.meta)

  return (
    <>
      <p className="intro">
        백엔드에서 마주치는 문제를 하나씩 재현하고 고쳐보는 기록입니다.
        실험은 문제를 재현하고 측정한 뒤 고칩니다. 구현은 무엇을 고민했고
        왜 그렇게 정했는지를 남깁니다.
      </p>
      <ModuleList modules={modules} />
    </>
  )
}
