import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 루트에 lockfile이 둘이라 Next가 워크스페이스 루트를 잘못 잡는다.
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),
}

export default nextConfig
