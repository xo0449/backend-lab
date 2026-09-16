'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export interface SidebarItem {
  slug: string
  title: string
  type: 'experiment' | 'build'
}

/**
 * 모듈 목록을 항상 띄워둔다.
 *
 * 모듈이 늘면서 목록으로 돌아갔다 다시 들어오는 왕복이 생겼다.
 * 옆에 두면 그 왕복이 없어진다.
 */
export default function Sidebar({ items }: { items: SidebarItem[] }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLElement>(null)

  // 모듈이 늘어 목록이 화면보다 길어지면 현재 항목이 스크롤 밖에 있을 수 있다.
  useEffect(() => {
    const box = boxRef.current
    const current = box?.querySelector<HTMLElement>('.nav-item[data-active="true"]')
    if (!box || !current) return

    // offsetTop이 아니라 화면 좌표로 잰다. 패널이 sticky라 기준점이 다르다.
    const boxRect = box.getBoundingClientRect()
    const elRect = current.getBoundingClientRect()
    const pad = 16

    if (elRect.top < boxRect.top + pad) {
      box.scrollTop += elRect.top - boxRect.top - pad
    } else if (elRect.bottom > boxRect.bottom - pad) {
      box.scrollTop += elRect.bottom - boxRect.bottom + pad
    }
  }, [pathname])

  return (
    <>
      <button
        className="nav-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '닫기' : '모듈'}
      </button>

      <aside className="nav" data-open={open} ref={boxRef}>
        <Link
          href="/"
          className="nav-item"
          data-active={pathname === '/'}
          onClick={() => setOpen(false)}
        >
          전체 목록
        </Link>

        <div className="nav-group">모듈</div>
        {items.map((m) => (
          <Link
            key={m.slug}
            href={`/modules/${m.slug}`}
            className="nav-item"
            data-active={pathname.startsWith(`/modules/${m.slug}`)}
            onClick={() => setOpen(false)}
          >
            <span className="nav-type" data-type={m.type}>
              {m.type === 'experiment' ? '실험' : '구현'}
            </span>
            {m.title}
          </Link>
        ))}
      </aside>
    </>
  )
}
