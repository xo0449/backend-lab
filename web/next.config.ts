import path from 'node:path'
import type { NextConfig } from 'next'

// GitHub Pages는 <user>.github.io/<repo> 아래에 붙는다.
const basePath = process.env.PAGES === '1' ? '/backend-lab' : ''

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  // 루트에 lockfile이 둘이라 Next가 워크스페이스 루트를 잘못 잡는다.
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),
  images: { unoptimized: true },
}

export default nextConfig
