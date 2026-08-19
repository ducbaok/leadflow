import { Suspense } from 'react'
import { LeadsTable } from '@/components/leads/leads-table'

export const metadata = { title: 'Leads — LeadFlow' }

// Luồng B (Batch 1): TanStack Table server-side + status flow + CSV export.
// Contract API: docs/sot/40-api-contracts.md §Leads
export default function LeadsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Leads</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Server-side sort, filter, and pagination over your whole pipeline.
        </p>
      </div>
      {/* LeadsTable đọc state từ URL (useSearchParams) → cần Suspense boundary (Next 16). */}
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <LeadsTable />
      </Suspense>
    </div>
  )
}
