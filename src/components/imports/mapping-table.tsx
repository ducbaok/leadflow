'use client'

import { LEAD_FIELDS, LEAD_FIELD_LABELS, type ColumnMapping, type LeadField } from '@/lib/import/fields'

// Bảng map cột + preview 20 dòng đầu. Mỗi cột CSV có 1 dropdown chọn LeadField (hoặc bỏ qua).
// Uniqueness (mỗi field chỉ 1 cột) do component cha xử lý qua onChange.

export function MappingTable({
  headers,
  preview,
  mapping,
  onChange,
}: {
  headers: string[]
  preview: string[][]
  mapping: ColumnMapping
  onChange: (header: string, field: LeadField | null) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-zinc-900/80">
            {headers.map((h) => (
              <th key={h} className="border-b border-zinc-800 px-3 py-2 align-top">
                <div className="font-medium text-zinc-200" title={h}>
                  {h || <span className="italic text-zinc-500">(no header)</span>}
                </div>
                <select
                  value={mapping[h] ?? ''}
                  onChange={(e) => onChange(h, (e.target.value || null) as LeadField | null)}
                  className="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">— Ignore —</option>
                  {LEAD_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {LEAD_FIELD_LABELS[f]}
                    </option>
                  ))}
                </select>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.map((row, i) => (
            <tr key={i} className="odd:bg-zinc-950 even:bg-zinc-900/40">
              {headers.map((h, c) => (
                <td key={h} className="max-w-[16rem] truncate border-b border-zinc-900 px-3 py-1.5 text-zinc-400" title={row[c] ?? ''}>
                  {row[c] || <span className="text-zinc-700">·</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.length === 0 && (
        <p className="px-3 py-4 text-sm text-zinc-500">No preview rows.</p>
      )}
    </div>
  )
}
