'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { ModuleMeta } from '../../shared/module-meta'

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'experiment', label: '실험' },
  { key: 'build', label: '구현' },
] as const

/** 제목, 요약, 고민, 태그를 한 줄로 합쳐 검색 대상으로 쓴다. */
function haystack(m: ModuleMeta): string {
  return [m.title, m.summary, m.question, ...m.tags].join(' ').toLowerCase()
}

export default function ModuleList({ modules }: { modules: ModuleMeta[] }) {
  const [filter, setFilter] = useState<string>('all')
  const [query, setQuery] = useState('')

  const indexed = useMemo(
    () => modules.map((m) => ({ meta: m, text: haystack(m) })),
    [modules],
  )

  const shown = useMemo(() => {
    // 공백으로 나눈 조각이 전부 들어 있어야 한다.
    // 한 단어만 맞는 것보다 여러 단어가 같이 맞는 쪽이 보통 원하는 결과다.
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)

    return indexed
      .filter(({ meta }) => filter === 'all' || meta.type === filter)
      .filter(({ text }) => terms.every((t) => text.includes(t)))
      .map(({ meta }) => meta)
  }, [indexed, filter, query])

  return (
    <>
      <div className="search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="제목, 고민, 태그로 찾기"
          aria-label="모듈 검색"
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="지우기">
            ×
          </button>
        )}
      </div>

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
        <span className="result-count">
          {shown.length === modules.length ? `${modules.length}개` : `${shown.length}개`}
        </span>
      </div>

      {shown.length === 0 && (
        <p className="empty">찾는 것이 없다. 다른 말로 찾아본다.</p>
      )}

      {shown.map((m) => (
        <Link className="card" key={m.slug} href={`/modules/${m.slug}`}>
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
        </Link>
      ))}
    </>
  )
}
