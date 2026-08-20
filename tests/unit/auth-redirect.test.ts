import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/auth/demo/route'
import { SESSION_COOKIE } from '@/lib/session'

// Hồi quy cho lỗi chỉ lộ ở bản standalone/container (Batch 3, luồng G):
// `new URL('/leads', request.url)` dựng Location từ HOSTNAME server đang bind
// → `http://0.0.0.0:3000/leads` → demo trên Railway không đăng nhập được.
// Location phải là đường dẫn TƯƠNG ĐỐI, không chứa host.

describe('POST /api/auth/demo', () => {
  it('trả 303 với Location tương đối, không kèm host', async () => {
    const res = await POST()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/leads')
  })

  it('đặt cookie session httpOnly', async () => {
    const res = await POST()
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(SESSION_COOKIE)
    expect(cookie.toLowerCase()).toContain('httponly')
  })
})
