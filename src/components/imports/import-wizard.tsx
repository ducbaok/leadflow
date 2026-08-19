'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnMapping, LeadField } from '@/lib/import/fields'
import { MappingTable } from './mapping-table'

type UploadResponse = {
  batchId: string
  headers: string[]
  preview: string[][]
  guessedMapping: ColumnMapping
}

type BatchStatus = {
  id: string
  filename: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  totalRows: number
  validRows: number
  errorRows: number
  insertedLeads: number
  updatedLeads: number
  durationMs: number | null
  error: string | null
  errors: { rowNumber: number; message: string }[]
}

type Template = { id: string; name: string; mapping: ColumnMapping }

type Step = 'upload' | 'map' | 'progress'

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body
}

export function ImportWizard() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('upload')
  const [upload, setUpload] = useState<UploadResponse | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [batchId, setBatchId] = useState<string | null>(null)
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  // ── Upload ──────────────────────────────────────────────────────────────
  const uploadMut = useMutation({
    mutationFn: async (file: File): Promise<UploadResponse> => {
      const fd = new FormData()
      fd.append('file', file)
      return jsonOrThrow(await fetch('/api/imports', { method: 'POST', body: fd }))
    },
    onSuccess: (data) => {
      setUpload(data)
      setMapping(data.guessedMapping)
      setBatchId(data.batchId)
      setStep('map')
    },
  })

  // ── Templates ───────────────────────────────────────────────────────────
  const templatesQuery = useQuery<{ templates: Template[] }>({
    queryKey: ['import-templates'],
    queryFn: async () => jsonOrThrow(await fetch('/api/imports/templates')),
    enabled: step === 'map',
  })

  // ── Start import ──────────────────────────────────────────────────────────
  const startMut = useMutation({
    mutationFn: async () => {
      const body: { mapping: ColumnMapping; templateName?: string } = { mapping }
      if (saveTemplate && templateName.trim()) body.templateName = templateName.trim()
      return jsonOrThrow(await fetch(`/api/imports/${batchId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-templates'] })
      setStep('progress')
    },
  })

  // ── Progress polling ──────────────────────────────────────────────────────
  const progressQuery = useQuery<BatchStatus>({
    queryKey: ['import-batch', batchId],
    queryFn: async () => jsonOrThrow(await fetch(`/api/imports/${batchId}`)),
    enabled: step === 'progress' && !!batchId,
    refetchInterval: (query) => {
      const s = query.state.data?.status
      return s === 'completed' || s === 'failed' ? false : 1000
    },
  })

  // Làm mới lịch sử import khi batch kết thúc (không invalidate trong lúc render).
  const progressStatus = progressQuery.data?.status
  useEffect(() => {
    if (progressStatus === 'completed' || progressStatus === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['imports'] })
    }
  }, [progressStatus, queryClient])

  function setFieldForHeader(header: string, field: LeadField | null) {
    setMapping((prev) => {
      const next: ColumnMapping = { ...prev }
      if (field) {
        // Mỗi field chỉ thuộc 1 cột: gỡ field khỏi cột khác đang giữ nó.
        for (const h of Object.keys(next)) if (next[h] === field) next[h] = null
      }
      next[header] = field
      return next
    })
  }

  function applyTemplate(t: Template | undefined) {
    if (!t || !upload) return
    const next: ColumnMapping = {}
    for (const h of upload.headers) next[h] = t.mapping[h] ?? null
    setMapping(next)
  }

  function reset() {
    setStep('upload')
    setUpload(null)
    setMapping({})
    setBatchId(null)
    setSaveTemplate(false)
    setTemplateName('')
    uploadMut.reset()
    startMut.reset()
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      {/* Steps indicator */}
      <ol className="mb-5 flex items-center gap-2 text-xs text-zinc-500">
        {(['upload', 'map', 'progress'] as Step[]).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                step === s ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {i + 1}
            </span>
            <span className={step === s ? 'text-zinc-200' : ''}>
              {s === 'upload' ? 'Upload CSV' : s === 'map' ? 'Map columns' : 'Import'}
            </span>
            {i < 2 && <span className="mx-1 text-zinc-700">→</span>}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <UploadStep
          pending={uploadMut.isPending}
          error={uploadMut.error instanceof Error ? uploadMut.error.message : null}
          onFile={(f) => uploadMut.mutate(f)}
        />
      )}

      {step === 'map' && upload && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-300">
                <span className="font-medium text-zinc-100">{upload.headers.length}</span> columns detected ·{' '}
                <span className="font-medium text-zinc-100">{mappedCount}</span> mapped
              </p>
              <p className="text-xs text-zinc-500">Preview shows the first {upload.preview.length} rows. Adjust any column below.</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400">Load template</label>
              <select
                defaultValue=""
                onChange={(e) => applyTemplate(templatesQuery.data?.templates.find((t) => t.id === e.target.value))}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">— Select —</option>
                {templatesQuery.data?.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <MappingTable headers={upload.headers} preview={upload.preview} mapping={mapping} onChange={setFieldForHeader} />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} className="accent-emerald-500" />
              Save this mapping as a template
              {saveTemplate && (
                <input
                  type="text"
                  placeholder="Template name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="ml-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                />
              )}
            </label>
            <div className="flex items-center gap-2">
              <button onClick={reset} className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">
                Cancel
              </button>
              <button
                onClick={() => startMut.mutate()}
                disabled={mappedCount === 0 || startMut.isPending || (saveTemplate && !templateName.trim())}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {startMut.isPending ? 'Starting…' : 'Start import →'}
              </button>
            </div>
          </div>
          {startMut.error instanceof Error && <p className="text-sm text-red-400">{startMut.error.message}</p>}
        </div>
      )}

      {step === 'progress' && <ProgressStep data={progressQuery.data} onReset={reset} />}
    </div>
  )
}

function UploadStep({ pending, error, onFile }: { pending: boolean; error: string | null; onFile: (f: File) => void }) {
  const [dragOver, setDragOver] = useState(false)
  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
          dragOver ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-700 hover:border-zinc-600'
        }`}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <p className="text-sm text-zinc-300">{pending ? 'Uploading & parsing…' : 'Drop a CSV here or click to browse'}</p>
        <p className="mt-1 text-xs text-zinc-500">Max 20MB. First row must be the header.</p>
      </label>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-4 text-xs text-zinc-600">
        Try the samples in <code className="text-zinc-400">public/samples/</code>: leads-clean.csv, leads-messy.csv, leads-10k.csv.
      </p>
    </div>
  )
}

function ProgressStep({ data, onReset }: { data: BatchStatus | undefined; onReset: () => void }) {
  if (!data) {
    return <p className="text-sm text-zinc-400">Starting…</p>
  }
  const processing = data.status === 'pending' || data.status === 'processing'
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {processing && <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-400" />}
        <p className="text-sm">
          <span className="text-zinc-400">Status: </span>
          <span
            className={
              data.status === 'completed'
                ? 'font-medium text-emerald-300'
                : data.status === 'failed'
                  ? 'font-medium text-red-300'
                  : 'font-medium text-amber-300'
            }
          >
            {data.status}
          </span>
        </p>
      </div>

      {data.error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{data.error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Total rows" value={data.totalRows} />
        <Stat label="Valid" value={data.validRows} />
        <Stat label="Errors" value={data.errorRows} tone={data.errorRows > 0 ? 'red' : undefined} />
        <Stat label="New leads" value={data.insertedLeads} tone="emerald" />
        <Stat label="Updated" value={data.updatedLeads} />
      </div>

      {data.durationMs != null && (
        <p className="text-xs text-zinc-500">
          Import took <span className="tabular-nums text-zinc-300">{(data.durationMs / 1000).toFixed(2)}s</span>.
        </p>
      )}

      {data.errors.length > 0 && (
        <details className="rounded-lg border border-zinc-800 bg-zinc-950/50" open>
          <summary className="cursor-pointer px-3 py-2 text-sm text-zinc-300">
            Row errors ({data.errorRows}{data.errors.length < data.errorRows ? `, showing first ${data.errors.length}` : ''})
          </summary>
          <ul className="max-h-64 overflow-y-auto px-3 py-2 text-xs text-zinc-400">
            {data.errors.map((e) => (
              <li key={e.rowNumber} className="border-b border-zinc-900 py-1 last:border-0">
                <span className="tabular-nums text-zinc-500">Row {e.rowNumber}:</span> {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!processing && (
        <button onClick={onReset} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-700">
          Import another file
        </button>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'emerald' }) {
  const color = tone === 'red' ? 'text-red-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-zinc-100'
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  )
}
