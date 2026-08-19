export const metadata = { title: 'Dedupe — LeadFlow' }

// Luồng D (Batch 2) xây trang này: hàng đợi review cặp nghi trùng.
// Spec: docs/sot/20-dedupe-spec.md; contract API: docs/sot/40-api-contracts.md §Dedupe
export default function DedupePage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Dedupe review</h1>
      <p className="mt-2 text-sm text-zinc-400">Coming in Batch 2 — Stream D (fuzzy pairs via pg_trgm, keep/archive decisions).</p>
    </div>
  )
}
