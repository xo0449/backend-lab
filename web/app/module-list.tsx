'use client'

import { useState } from 'react'
import type { ModuleMeta } from '../../shared/module-meta'

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'experiment', label: '실험' },
  { key: 'build', label: '구현' },
] as const

export default function ModuleList({ modules }: { modules: ModuleMeta[] }) {
  const [filter, setFilter] = useState<string>('all')
  const shown = filter === 'all' ? modules : modules.filter((m) => m.type === filter)

  return (
    <>
      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className="filter"
            data-active={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.map((m) => (
        <a className="card" key={m.slug} href={`/modules/${m.slug}`}>
          <span className="type" data-type={m.type}>
            {m.type === 'experiment' ? '실험' : '구현'}
          </span>
          <h2>{m.title}</h2>
          <p>{m.summary}</p>
          <div className="question">
            <span>고민</span>
            {m.question}
          </div>
          <div className="tags">
            {m.tags.map((t) => (
              <span className="tag" key={t}>{t}</span>
            ))}
          </div>
        </a>
      ))}
    </>
  )
}
