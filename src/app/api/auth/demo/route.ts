import { NextResponse } from 'next/server'
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from '@/lib/session'

// Location TƯƠNG ĐỐI, cố ý. `new URL('/leads', request.url)` dựng URL tuyệt đối từ
// HOSTNAME/PORT mà server đang bind — trong container standalone thành `http://0.0.0.0:3000/leads`,
// tức là bản deploy KHÔNG đăng nhập được. Relative Location hợp lệ theo RFC 7231 và
// đúng sau mọi reverse proxy (Railway) mà không cần đọc x-forwarded-*.
export async function POST() {
  const token = await createSessionToken()
  const res = new NextResponse(null, { status: 303, headers: { Location: '/leads' } })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
  return res
}
