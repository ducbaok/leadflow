'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { StatusSelect } from './status-select'
import { INDUSTRIES, type LeadDetailResponse } from './types'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-200">{children}</dd>
    </div>
  )
}

export function LeadDetail({ id }: { id: string }) {
  const query = useQuery<LeadDetailResponse>({
    queryKey: ['lead', id],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${id}`)
      if (res.status === 404) throw new Error('not-found')
      if (!res.ok) throw new Error('Failed to load lead')
      return res.json()
    },
  })

  if (query.isLoading) {
    return <p className="text-sm text-zinc-500">Loading…</p>
  }
  if (query.isError) {
    const notFound = (query.error as Error).message === 'not-found'
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">{notFound ? 'Lead not found.' : 'Failed to load lead.'}</p>
        <Link href="/leads" className="text-sm text-emerald-400 hover:text-emerald-300">
          ← Back to leads
        </Link>
      </div>
    )
  }

  const { lead, sources, scores } = query.data!
  const industryLabel = lead.industry
    ? (INDUSTRIES.find((i) => i.value === lead.industry)?.label ?? lead.industry)
    : '—'

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/leads" className="inline-block text-sm text-zinc-400 hover:text-zinc-200">
        ← Back to leads
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div>
          <h1 className="text-2xl font-semibold text-white">{lead.fullName ?? '—'}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {lead.title ? `${lead.title} · ` : ''}
            {lead.companyName ?? '—'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] tracking-wide text-zinc-500 uppercase">Status</span>
          <StatusSelect leadId={lead.id} status={lead.status} />
        </div>
      </div>

      {/* Info */}
      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-zinc-800 p-5 sm:grid-cols-3">
        <Field label="Email">{lead.email ?? '—'}</Field>
        <Field label="Phone">
          {lead.phone ? (
            <span className="inline-flex items-center gap-1.5">
              {lead.phone}
              <span
                className={`h-1.5 w-1.5 rounded-full ${lead.phoneValid ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                title={lead.phoneValid ? 'Valid phone' : 'Unverified phone'}
              />
            </span>
          ) : (
            '—'
          )}
        </Field>
        <Field label="Industry">{industryLabel}</Field>
        <Field label="Company size">{lead.companySize ?? '—'}</Field>
        <Field label="Created">{formatDateTime(lead.createdAt)}</Field>
      </dl>

      {/* Scores — read-only; luồng C/E lấp đầy ở Batch 2 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">Scores</h2>
        {scores.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
            Not scored yet — rule &amp; AI scoring arrive in Batch 2.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {scores.map((s) => (
              <div key={s.kind} className="rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
                    {s.kind}
                  </span>
                  <span className="text-lg font-semibold tabular-nums text-zinc-100">
                    {s.score ?? '—'}
                  </span>
                </div>
                {s.reason && <p className="mt-1.5 text-sm text-zinc-400">{s.reason}</p>}
                <p className="mt-2 text-[11px] text-zinc-600">
                  {s.status}
                  {s.model ? ` · ${s.model}` : ''}
                  {s.scoredAt ? ` · ${formatDateTime(s.scoredAt)}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sources / provenance history */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">
          Sources <span className="text-zinc-600">({sources.length})</span>
        </h2>
        <div className="space-y-3">
          {sources.map((src) => (
            <div key={src.id} className="rounded-xl border border-zinc-800 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{src.sourceType}</span>
                <span>{src.batchFilename ?? 'unknown batch'}</span>
                {src.rowNumber != null && <span>row #{src.rowNumber}</span>}
                <span className="ml-auto">{formatDateTime(src.createdAt)}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                {Object.entries(src.rawData).map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="truncate text-[11px] text-zinc-600">{k}</dt>
                    <dd className="truncate text-sm text-zinc-300" title={String(v ?? '')}>
                      {v === null || v === undefined || v === '' ? '—' : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
