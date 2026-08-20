import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { listPairs } from '@/lib/dedupe/query'

// GET /api/dedupe/pairs — hàng đợi review cặp nghi trùng (luồng D).
// Contract: docs/sot/40-api-contracts.md §Dedupe.
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: z.enum(['pending', 'merged', 'not_duplicate']).catch('pending').default('pending'),
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).catch(20).default(20),
})

export async function GET(request: NextRequest) {
  const raw: Record<string, string> = {}
  for (const [k, v] of request.nextUrl.searchParams.entries()) {
    if (v !== '') raw[k] = v
  }
  const q = querySchema.parse(raw)

  const result = await listPairs(q)
  return NextResponse.json(result)
}
