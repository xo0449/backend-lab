'use client'

import { useEffect, useState } from 'react'

interface Heading {
  id: string
  text: string
  level: number
}

function slugify(text: string, index: number) {
  const base = text.trim().toLowerCase().replace(/[^\w가-힣]+/g, '-').replace(/^-|-$/g, '')
  return base ? `${base}-${index}` : `h-${index}`
}

/**
 * 본문에서 목차를 만든다.
 *
 * 마크다운은 HTML 문자열로 들어오므로 제목에 id가 없다.
 * 여기서 id를 붙이고 목차를 만든다.
 *
 * 글이 길어져서 필요해진 기능이다. 500줄이 넘으면
 * 지금 어디쯤 읽고 있는지가 안 보인다.
 */
export default function Toc() {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [active, setActive] = useState<string>('')

  useEffect(() => {
    const article = document.querySelector('.readme')
    if (!article) return

    const found = Array.from(article.querySelectorAll('h2, h3')).map((el, i) => {
      const text = el.textContent ?? ''
      const id = el.id || slugify(text, i)
      el.id = id
      return { id, text, level: el.tagName === 'H2' ? 2 : 3 }
    })
    if (found.length === 0) return
    setHeadings(found)

    /**
     * 화면 위쪽 기준선보다 위에 있는 마지막 제목을 현재 위치로 본다.
     *
     * IntersectionObserver로 먼저 만들었는데, 좁은 띠 안에 제목이
     * 하나도 없는 순간에는 아무것도 안 잡혔다. 프로그램으로 스크롤하거나
     * 긴 절 가운데에 있으면 강조가 사라진다.
     * 위치를 직접 계산하면 항상 하나가 잡힌다.
     */
    const LINE = 96

    const sync = () => {
      let current = found[0].id
      for (const h of found) {
        const el = document.getElementById(h.id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= LINE) current = h.id
        else break
      }
      setActive(current)
    }

    sync()
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)

    // 다이어그램이 늦게 그려지면서 위치가 밀린다. 그때 한 번 더 맞춘다.
    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(article)

    return () => {
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      resizeObserver.disconnect()
    }
  }, [])

  if (headings.length === 0) return null

  return (
    <nav className="toc" aria-label="목차">
      <div className="toc-title">목차</div>
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          className="toc-item"
          data-level={h.level}
          data-active={active === h.id}
        >
          {h.text}
        </a>
      ))}
    </nav>
  )
}
