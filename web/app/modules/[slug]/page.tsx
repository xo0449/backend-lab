import { notFound } from 'next/navigation'
import { marked } from 'marked'
import { loadModule, loadModules } from '../../../lib/modules'

export function generateStaticParams() {
  return loadModules().map((m) => ({ slug: m.meta.slug }))
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const found = loadModule(slug)
  if (!found) notFound()

  const { meta, readme } = found
  const html = await marked.parse(readme)

  return (
    <>
      <a className="back" href="/">← 목록</a>

      <div className="question" style={{ marginTop: '1.5rem' }}>
        <span>이 모듈에서 고민한 것</span>
        {meta.question}
      </div>

      {meta.metrics && (
        <table>
          <thead>
            <tr><th>지표</th><th>개선 전</th><th>개선 후</th></tr>
          </thead>
          <tbody>
            {meta.metrics.map((m) => (
              <tr key={m.label}>
                <td>{m.label}</td><td>{m.before}</td><td>{m.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta.decisions && (
        <table>
          <thead>
            <tr><th>결정할 것</th><th>선택</th><th>이유</th></tr>
          </thead>
          <tbody>
            {meta.decisions.map((d) => (
              <tr key={d.question}>
                <td>{d.question}</td><td>{d.choice}</td><td>{d.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <article className="readme" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}
