import { SignJWT, jwtVerify } from 'jose'

// Demo 1-click auth (ADR-006): cookie JWT ký HS256, không user table, không password.
// Chạy được cả Node lẫn Edge runtime (proxy.ts dùng chung).

export const SESSION_COOKIE = 'leadflow_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 ngày

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET bắt buộc ở production')
    return new TextEncoder().encode('leadflow-dev-secret-not-for-production')
  }
  return new TextEncoder().encode(secret)
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ demo: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret())
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret())
    return true
  } catch {
    return false
  }
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS
