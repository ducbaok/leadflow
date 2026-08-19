export const metadata = { title: 'Scoring settings — LeadFlow' }

// Luồng C (Batch 1) xây trang này: rule JSON editor + ICP textarea + nút chấm lại.
// Spec: docs/sot/30-scoring-spec.md; contract API: docs/sot/40-api-contracts.md §Scoring
export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Scoring settings</h1>
      <p className="mt-2 text-sm text-zinc-400">Coming in Batch 1 — Stream C (rule config, ICP description, AI re-score).</p>
    </div>
  )
}
