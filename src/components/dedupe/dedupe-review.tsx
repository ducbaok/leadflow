'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { STATUS_META } from '@/components/leads/types'
import type { DedupeDecisionBody, DedupeLeadSnapshot, DedupePair, DedupePairsResponse } from '@/lib/dedupe/types'

// Review UI luồng D — 2 lead cạnh nhau, ĐÚNG 2 hành động: "Keep this one" (giữ bản này, archive bản
// kia) và "Not a duplicate". KHÔNG merge field-level (scope khoá — 00-scope.md). UI tiếng Anh.

const PAGE_SIZE = 20

function pct(sim: number | null): string {
  return sim == null ? '—' : `${Math.round(sim * 100)}%`
}

function simTone(sim: number | null): string {
  if (sim == null) return 'text-zinc-500'
  if (sim >= 0.9) return 'text-emerald-400'
  if (sim >= 0.55) return 'text-amber-400'
  return 'text-zinc-400'
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-zinc-200">{value ?? '—'}</dd>
    </div>
  )
}

function LeadCard({
  lead,
  side,
  onKeep,
  busy,
}: {
  lead: DedupeLeadSnapshot
  side: 'A' | 'B'
  onKeep: () => void
  busy: boolean
}) {
  const meta = STATUS_META[lead.status]
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-zinc-600 uppercase">Lead {side}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.badge}`}>
          {meta.label}
        </span>
      </div>
      <h3 className="truncate text-base font-semibold text-white" title={lead.fullName ?? undefined}>
        {lead.fullName ?? '—'}
      </h3>
      <p className="mt-0.5 truncate text-sm text-zinc-400" title={lead.companyName ?? undefined}>
        {lead.title ? `${lead.title} · ` : ''}
        {lead.companyName ?? '—'}
      </p>

      <dl className="mt-3 divide-y divide-zinc-800/60 border-t border-zinc-800/60">
        <Row label="Email" value={lead.email} />
        <Row
          label="Phone"
          value={
            lead.phone ? (
              <span className="inline-flex items-center gap-1.5">
                {lead.phone}
                <span
                  className={`h-1.5 w-1.5 rounded-full ${lead.phoneValid ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                />
              </span>
            ) : null
          }
        />
        <Row label="Company size" value={lead.companySize} />
        <Row label="Sources" value={lead.sourceCount} />
        <Row
          label="Scores"
          value={
            lead.ruleScore == null && lead.aiScore == null
              ? '—'
              : `rule ${lead.ruleScore ?? '—'} · ai ${lead.aiScore ?? '—'}`
          }
        />
      </dl>

      <button
        onClick={onKeep}
        disabled={busy}
        className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-emerald-500 px-3 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
      >
        Keep this one
      </button>
    </div>
  )
}

function PairCard({ pair }: { pair: DedupePair }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (body: DedupeDecisionBody) => {
      const res = await fetch(`/api/dedupe/pairs/${pair.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(b.error ?? 'Decision failed')
      }
      return res.json() as Promise<{ ok: true }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dedupe-pairs'] }),
  })

  const busy = mutation.isPending

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      {/* Similarity header */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>
          Name match <span className={`font-semibold tabular-nums ${simTone(pair.nameSimilarity)}`}>{pct(pair.nameSimilarity)}</span>
        </span>
        <span>
          Company match{' '}
          <span className={`font-semibold tabular-nums ${simTone(pair.companySimilarity)}`}>{pct(pair.companySimilarity)}</span>
        </span>
        <span className="ml-auto text-zinc-600">flagged {new Date(pair.createdAt).toLocaleDateString('en-GB')}</span>
      </div>

      {/* Two leads side by side */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <LeadCard lead={pair.a} side="A" busy={busy} onKeep={() => mutation.mutate({ decision: 'merged', keptLeadId: pair.a.id })} />
        <div className="flex items-center justify-center px-1 text-xs font-medium text-zinc-600">vs</div>
        <LeadCard lead={pair.b} side="B" busy={busy} onKeep={() => mutation.mutate({ decision: 'merged', keptLeadId: pair.b.id })} />
      </div>

      {/* Not-a-duplicate + status */}
      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          onClick={() => mutation.mutate({ decision: 'not_duplicate' })}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-lg border border-zinc-700 px-4 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
        >
          Not a duplicate
        </button>
        {busy && <span className="text-xs text-zinc-500">saving…</span>}
        {mutation.isError && (
          <span className="text-xs text-rose-400" title={mutation.error.message}>
            {mutation.error.message}
          </span>
        )}
      </div>
    </div>
  )
}

export function DedupeReview() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)

  const query = useQuery<DedupePairsResponse>({
    queryKey: ['dedupe-pairs', page],
    queryFn: async () => {
      const res = await fetch(`/api/dedupe/pairs?status=pending&page=${page}&pageSize=${PAGE_SIZE}`)
      if (!res.ok) throw new Error('Failed to load pairs')
      return res.json()
    },
    placeholderData: keepPreviousData,
  })

  const rescan = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/dedupe/scan', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to enqueue scan')
      return res.json() as Promise<{ ok: true }>
    },
  })

  const total = query.data?.total ?? 0
  const pairs = query.data?.pairs ?? []
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-zinc-500 tabular-nums">
          {total.toLocaleString('en-US')} pending {total === 1 ? 'pair' : 'pairs'}
          {query.isFetching && <span className="ml-2 text-zinc-600">· updating…</span>}
        </span>
        <button
          onClick={() => rescan.mutate(undefined, { onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['dedupe-pairs'] }), 1500) })}
          disabled={rescan.isPending}
          className="ml-auto inline-flex h-9 items-center rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
        >
          {rescan.isPending ? 'Scanning…' : 'Run scan'}
        </button>
      </div>
      {rescan.isSuccess && (
        <p className="text-xs text-zinc-500">Scan enqueued — new pairs appear here once the background job finishes.</p>
      )}

      {query.isError ? (
        <p className="rounded-xl border border-zinc-800 p-10 text-center text-rose-400">Failed to load pairs. Try again.</p>
      ) : query.isLoading ? (
        <p className="rounded-xl border border-zinc-800 p-10 text-center text-zinc-500">Loading…</p>
      ) : pairs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-10 text-center">
          <p className="text-sm text-zinc-300">No duplicates to review 🎉</p>
          <p className="mt-1 text-xs text-zinc-500">
            Fuzzy matches surface here after an import or a manual scan. Decided pairs are never asked again.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pairs.map((pair) => (
            <PairCard key={pair.id} pair={pair} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-zinc-400">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="h-8 rounded-lg border border-zinc-800 px-3 text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="tabular-nums text-zinc-500">
            Page {page} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="h-8 rounded-lg border border-zinc-800 px-3 text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
