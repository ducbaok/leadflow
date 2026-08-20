import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pg-boss (pg driver) và postgres-js không nên bị bundle vào server build
  serverExternalPackages: ['pg-boss', 'postgres'],
  // Standalone CHỈ bật khi build trong Docker (Dockerfile đặt NEXT_OUTPUT_STANDALONE=1) — ADR-009.
  // Không bật mặc định vì `next start` cảnh báo "does not work with output: standalone",
  // mà `npm run start` là thứ Playwright + CI e2e dùng.
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
}

export default nextConfig
