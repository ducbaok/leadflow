import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { leadScores } from '@/db/schema'

// Luồng C sở hữu. Contract: docs/sot/40-api-contracts.md §Scoring.
export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  const rows = await db
    .select({
      kind: leadScores.kind,
      status: leadScores.status,
      count: sql<number>`count(*)::int`,
    })
    .from(leadScores)
    .groupBy(leadScores.kind, leadScores.status)

  let ruleScored = 0
  let aiScored = 0
  let aiPending = 0
  let aiFailed = 0
  for (const r of rows) {
    if (r.kind === 'rule' && r.status === 'completed') ruleScored += r.count
    if (r.kind === 'ai') {
      if (r.status === 'completed') aiScored += r.count
      else if (r.status === 'pending') aiPending += r.count
      else if (r.status === 'failed') aiFailed += r.count
    }
  }

  return NextResponse.json({ ruleScored, aiScored, aiPending, aiFailed })
}
