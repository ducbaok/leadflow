export const metadata = { title: 'Imports — LeadFlow' }

// Luồng A (Batch 1) xây trang này: upload CSV + mapping UI + progress.
// Contract API: docs/sot/40-api-contracts.md §Imports
export default function ImportsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Imports</h1>
      <p className="mt-2 text-sm text-zinc-400">Coming in Batch 1 — Stream A (CSV upload, column mapping, background import).</p>
    </div>
  )
}
