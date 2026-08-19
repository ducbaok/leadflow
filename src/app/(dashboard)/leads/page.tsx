export const metadata = { title: 'Leads — LeadFlow' }

// Luồng B (Batch 1) xây trang này: TanStack Table server-side + status flow + export.
// Contract API: docs/sot/40-api-contracts.md §Leads
export default function LeadsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Leads</h1>
      <p className="mt-2 text-sm text-zinc-400">Coming in Batch 1 — Stream B (dashboard, server-side table, CSV export).</p>
    </div>
  )
}
