import { NextResponse } from 'next/server'
import { asc } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { mappingTemplates } from '@/db/schema'

// GET /api/imports/templates → { templates: [{ id, name, mapping }] }
// SoT contract: docs/sot/40-api-contracts.md §Imports
// (Route tĩnh "templates" ưu tiên hơn "[batchId]" động ở cùng cấp — Next.js resolve tĩnh trước.)

export async function GET() {
  const db = getDb()
  const templates = await db
    .select({ id: mappingTemplates.id, name: mappingTemplates.name, mapping: mappingTemplates.mapping })
    .from(mappingTemplates)
    .orderBy(asc(mappingTemplates.name))
  return NextResponse.json({ templates })
}
