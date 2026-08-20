import { NextResponse } from 'next/server'
import { sendJob } from '@/jobs/boss'
import { JOB } from '@/jobs/contracts'

// POST /api/dedupe/scan — enqueue quét fuzzy toàn cục (luồng D). Contract: 40-api-contracts.md §Dedupe.
// Scan chạy nền qua pg-boss (không block request); kết quả xuất hiện ở GET /api/dedupe/pairs.
export const dynamic = 'force-dynamic'

export async function POST() {
  await sendJob(JOB.dedupeScan, {})
  return NextResponse.json({ ok: true })
}
