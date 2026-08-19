'use client'

import { useQuery } from '@tanstack/react-query'

type BatchRow = {
  id: string
  filename: string | null
  sourceType: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  totalRows: number
  validRows: number
  errorRows: number
  insertedLeads: number
  updatedLeads: number
  durationMs: number | null
  createdAt: string
}

const STATUS_STYLES: Record<BatchRow['status'], string> = {
  pending: 'bg-zinc-700/40 text-zinc-300',
  processing: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function ImportHistory() {
  const { data, isLoading } = useQuery<{ batches: BatchRow[] }>({
    queryKey: ['imports'],
    queryFn: async () => {
      const res = await fetch('/api/imports')
      if (!res.ok) throw new Error('Failed to load imports')
      return res.json()
    },
    refetchInterval: 5000,
  })

  const batches = data?.batches ?? []

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">Import history</h2>
      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : batches.length === 0 ? (
        <p className="text-sm text-zinc-500">No imports yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
                <th className="px-3 py-2 text-right font-medium">Valid</th>
                <th className="px-3 py-2 text-right font-medium">Errors</th>
                <th className="px-3 py-2 text-right font-medium">New</th>
                <th className="px-3 py-2 text-right font-medium">Updated</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-zinc-900">
                  <td className="px-3 py-2 text-zinc-200">
                    {b.filename ?? '—'}
                    {b.sourceType !== 'csv' && <span className="ml-2 text-[11px] text-zinc-500">({b.sourceType})</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[b.status]}`}>{b.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{b.totalRows.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{b.validRows.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${b.errorRows > 0 ? 'text-red-300' : 'text-zinc-600'}`}>
                    {b.errorRows.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{b.insertedLeads.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{b.updatedLeads.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{fmtDuration(b.durationMs)}</td>
                  <td className="px-3 py-2 text-zinc-500">{new Date(b.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
