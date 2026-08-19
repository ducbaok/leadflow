'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

// UI tiếng Anh, dữ liệu demo tiếng Việt (ADR-004). Contract: docs/sot/40-api-contracts.md §Scoring.

type ConfigResponse = { icpDescription: string; rules: unknown; aiTopN: number }
type StatusResponse = { ruleScored: number; aiScored: number; aiPending: number; aiFailed: number }

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`)
  return res.json() as Promise<T>
}

async function sendJson(url: string, method: 'PUT' | 'POST', body: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json as { ok?: boolean; enqueued?: number }
}

export function ScoringSettings() {
  // Query chỉ để "gate" — Editor khởi tạo state từ config đã tải (mount 1 lần, không dùng effect).
  const config = useQuery({ queryKey: ['scoring-config'], queryFn: () => fetchJson<ConfigResponse>('/api/scoring/config') })

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">Scoring settings</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Rule score (free, instant, set-based) and AI score (background, cached) live in{' '}
        <span className="text-zinc-200">two separate columns</span> — never summed.
      </p>

      {config.isLoading ? (
        <p className="mt-6 text-sm text-zinc-500">Loading config…</p>
      ) : config.isError ? (
        <p className="mt-6 text-sm text-red-400">Failed to load config: {(config.error as Error).message}</p>
      ) : (
        <ScoringEditor initial={config.data!} />
      )}
    </div>
  )
}

function ScoringEditor({ initial }: { initial: ConfigResponse }) {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ['scoring-status'],
    queryFn: () => fetchJson<StatusResponse>('/api/scoring/status'),
    refetchInterval: 4000,
  })

  const [icp, setIcp] = useState(initial.icpDescription ?? '')
  const [rulesText, setRulesText] = useState(() => JSON.stringify(initial.rules, null, 2))
  const [aiTopN, setAiTopN] = useState(initial.aiTopN ?? 200)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      let rules: unknown
      try {
        rules = JSON.parse(rulesText)
      } catch {
        throw new Error('Rule config is not valid JSON')
      }
      return sendJson('/api/scoring/config', 'PUT', { icpDescription: icp, rules, aiTopN })
    },
    onMutate: () => {
      setError(null)
      setNotice(null)
    },
    onSuccess: () => {
      setNotice('Config saved — rule re-scoring enqueued.')
      queryClient.invalidateQueries({ queryKey: ['scoring-status'] })
    },
    onError: (err: Error) => setError(err.message),
  })

  const runRule = useMutation({
    mutationFn: () => sendJson('/api/scoring/run', 'POST', { kind: 'rule' }),
    onMutate: () => {
      setError(null)
      setNotice(null)
    },
    onSuccess: (r) => setNotice(`Rule scoring enqueued for ${r.enqueued} leads.`),
    onError: (err: Error) => setError(err.message),
  })

  const runAi = useMutation({
    mutationFn: () => sendJson('/api/scoring/run', 'POST', { kind: 'ai' }),
    onMutate: () => {
      setError(null)
      setNotice(null)
    },
    onSuccess: (r) => setNotice(`AI scoring enqueued for ${r.enqueued} top leads (unchanged leads skip the API).`),
    onError: (err: Error) => setError(err.message),
  })

  const busy = save.isPending || runRule.isPending || runAi.isPending

  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Rule scored" value={status.data?.ruleScored} />
        <StatCard label="AI scored" value={status.data?.aiScored} />
        <StatCard label="AI pending" value={status.data?.aiPending} />
        <StatCard label="AI failed" value={status.data?.aiFailed} tone={status.data?.aiFailed ? 'warn' : 'default'} />
      </div>

      <section>
        <label className="block text-sm font-medium text-zinc-200">ICP description</label>
        <p className="mb-2 text-xs text-zinc-500">Context sent to the AI scorer. Vietnamese demo data.</p>
        <textarea
          value={icp}
          onChange={(e) => setIcp(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
          placeholder="Mô tả khách hàng lý tưởng…"
        />
      </section>

      <section>
        <label className="block text-sm font-medium text-zinc-200">Rule config (JSON)</label>
        <p className="mb-2 text-xs text-zinc-500">
          Schema: docs/sot/30-scoring-spec.md — ops: contains_any, in, between, equals, is_company_domain.
        </p>
        <textarea
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          rows={16}
          spellCheck={false}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-600"
        />
      </section>

      <section>
        <label className="block text-sm font-medium text-zinc-200">AI top-N</label>
        <p className="mb-2 text-xs text-zinc-500">How many highest rule-scored leads get AI scored per run.</p>
        <input
          type="number"
          min={1}
          max={1000}
          value={aiTopN}
          onChange={(e) => setAiTopN(Number(e.target.value))}
          className="w-32 rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={busy}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save config'}
        </button>
        <button
          onClick={() => runRule.mutate()}
          disabled={busy}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
        >
          {runRule.isPending ? 'Enqueuing…' : 'Re-score (rules)'}
        </button>
        <button
          onClick={() => runAi.mutate()}
          disabled={busy}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
        >
          {runAi.isPending ? 'Enqueuing…' : 'Score AI (top-N)'}
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value, tone = 'default' }: { label: string; value?: number; tone?: 'default' | 'warn' }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className={`text-2xl font-semibold ${tone === 'warn' ? 'text-amber-400' : 'text-white'}`}>{value ?? '—'}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  )
}
