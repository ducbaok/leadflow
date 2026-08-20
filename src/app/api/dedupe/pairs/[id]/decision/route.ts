import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { applyDecision } from '@/lib/dedupe/decision'

// POST /api/dedupe/pairs/:id/decision — quyết định "merged" | "not_duplicate" (luồng D).
// Transaction theo docs/sot/20-dedupe-spec.md §State machine. Contract: 40-api-contracts.md §Dedupe.
export const dynamic = 'force-dynamic'

const idSchema = z.string().uuid()
const bodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('merged'), keptLeadId: z.string().uuid() }),
  z.object({ decision: z.literal('not_duplicate') }),
])

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsedId = idSchema.safeParse((await ctx.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid pair id' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsedBody = bodySchema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid decision body' }, { status: 400 })
  }

  const result = await applyDecision(parsedId.data, parsedBody.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
