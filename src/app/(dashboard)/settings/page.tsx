import { ScoringSettings } from './scoring-settings'

export const metadata = { title: 'Scoring settings — LeadFlow' }

// Luồng C (Batch 1): rule JSON editor + ICP textarea + nút chấm lại.
// Spec: docs/sot/30-scoring-spec.md; contract API: docs/sot/40-api-contracts.md §Scoring
export default function SettingsPage() {
  return <ScoringSettings />
}
