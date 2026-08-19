import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pg-boss (pg driver) và postgres-js không nên bị bundle vào server build
  serverExternalPackages: ['pg-boss', 'postgres'],
}

export default nextConfig
