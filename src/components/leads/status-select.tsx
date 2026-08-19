'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { STATUS_META, STATUS_FLOW, type LeadStatus } from './types'

// Đổi status theo phễu New → Contacted → Qualified → Won/Lost.
// Tự chứa mutation → dùng chung ở bảng lead và trang chi tiết mà không cần prop callback.
// Contract: PATCH /api/leads/:id body { status } (docs/sot/40-api-contracts.md §Leads).
export function StatusSelect({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (next: LeadStatus) => {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Failed to update status')
      }
      return res.json() as Promise<{ ok: true }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })

  const meta = STATUS_META[status]

  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        aria-label="Change status"
        value={status}
        disabled={mutation.isPending}
        onChange={(e) => mutation.mutate(e.target.value as LeadStatus)}
        onClick={(e) => e.stopPropagation()}
        className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset outline-none transition disabled:opacity-50 ${meta.badge}`}
      >
        {STATUS_FLOW.map((s) => (
          <option key={s.value} value={s.value} className="bg-zinc-900 text-zinc-100">
            {s.label}
          </option>
        ))}
      </select>
      {mutation.isPending && <span className="text-[11px] text-zinc-500">saving…</span>}
      {mutation.isError && (
        <span className="text-[11px] text-rose-400" title={mutation.error.message}>
          failed
        </span>
      )}
    </div>
  )
}
