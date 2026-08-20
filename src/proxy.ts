import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'

// Next 16: proxy.ts thay cho middleware.ts (deprecated).
// Rào cửa demo: chưa có session → về /login. Đã có session mà vào /login → về /leads.

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const authed = token ? await verifySessionToken(token) : false

  // Ops miễn session (40-api-contracts §Ops): healthcheck của Railway gọi không kèm cookie,
  // còn /api/admin/* tự bảo vệ bằng ADMIN_RESET_TOKEN để gọi được bằng curl từ máy khác.
  const isPublic =
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname === '/api/health' ||
    pathname.startsWith('/api/admin/')

  if (isPublic) {
    if (authed && pathname === '/login') {
      return NextResponse.redirect(new URL('/leads', request.url))
    }
    return NextResponse.next()
  }

  if (!authed) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // Bỏ qua static assets + file mẫu công khai
  matcher: ['/((?!_next/static|_next/image|favicon.ico|samples/|.*\\.(?:svg|png|jpg|jpeg|gif|ico|css|js|csv)$).*)'],
}
