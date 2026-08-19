import { ImportHistory } from '@/components/imports/import-history'
import { ImportWizard } from '@/components/imports/import-wizard'

export const metadata = { title: 'Imports — LeadFlow' }

// Luồng A (Batch 1): upload CSV → map cột → import nền + progress.
// Contract API: docs/sot/40-api-contracts.md §Imports
export default function ImportsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Imports</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Upload a CSV, map its columns to lead fields, and promote into your pipeline. Duplicate emails merge
          automatically; rows without an email still import.
        </p>
      </div>
      <ImportWizard />
      <ImportHistory />
    </div>
  )
}
