import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'backend-lab',
  description: '백엔드에서 마주치는 문제를 하나씩 재현하고 고쳐보는 기록',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <Link href="/">backend-lab</Link>
          <a
            className="repo-link"
            href="https://github.com/xo0449/backend-lab"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
