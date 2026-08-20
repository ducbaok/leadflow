import { DedupeReview } from '@/components/dedupe/dedupe-review'

export const metadata = { title: 'Dedupe — LeadFlow' }

// Luồng D (Batch 2): hàng đợi review cặp nghi trùng (fuzzy pg_trgm).
// Spec: docs/sot/20-dedupe-spec.md; contract API: docs/sot/40-api-contracts.md §Dedupe.
export default function DedupePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Dedupe review</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Fuzzy matches flagged by pg_trgm. Keep one record (the other is archived) or mark the pair as not a duplicate.
        </p>
      </div>
      <DedupeReview />
    </div>
  )
}
