'use client'

import { usePathname } from 'next/navigation'
import Toc from './toc'

/**
 * 목록과 글에서 레이아웃이 다르다.
 *
 * 목록은 그 자체가 탐색 화면이라 옆에 아무것도 두지 않는다.
 * 글에서만 오른쪽에 목차를 띄운다.
 */
export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isIndex = pathname === '/'

  return (
    <div className="shell" data-index={isIndex}>
      <main>{children}</main>
      {!isIndex && <Toc />}
    </div>
  )
}
