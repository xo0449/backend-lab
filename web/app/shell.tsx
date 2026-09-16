'use client'

import { usePathname } from 'next/navigation'
import Sidebar, { type SidebarItem } from './sidebar'
import Toc from './toc'

/**
 * 목록과 글에서 레이아웃이 다르다.
 *
 * 목록은 그 자체가 탐색 화면이라 옆에 목록을 또 둘 이유가 없다.
 * 글에서만 사이드바와 목차를 띄운다.
 */
export default function Shell({
  items,
  children,
}: {
  items: SidebarItem[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isIndex = pathname === '/'

  return (
    <div className="shell" data-index={isIndex}>
      {!isIndex && <Sidebar items={items} />}
      <main>{children}</main>
      {!isIndex && <Toc />}
    </div>
  )
}
