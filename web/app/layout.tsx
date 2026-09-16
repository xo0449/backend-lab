import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { loadModules } from '../lib/modules'
import Sidebar from './sidebar'
import Toc from './toc'

export const metadata: Metadata = {
  title: 'backend-lab',
  description: '백엔드에서 마주치는 문제를 하나씩 재현하고 고쳐보는 기록',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const items = loadModules().map((m) => ({
    slug: m.meta.slug,
    title: m.meta.title,
    type: m.meta.type,
  }))

  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <Link href="/">backend-lab</Link>
          <nav className="nav-links">
            <a href="https://xo0449.github.io/">블로그</a>
            <a href="https://github.com/xo0449/backend-lab">GitHub</a>
          </nav>
        </header>

        <div className="shell">
          <Sidebar items={items} />
          <main>{children}</main>
          <Toc />
        </div>
      </body>
    </html>
  )
}
