'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type PaginationState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StatusSelect } from './status-select'
import { INDUSTRIES, STATUS_FLOW, type LeadRow, type LeadsResponse } from './types'

// Bảng lead server-side: sort/filter/pagination đẩy hết xuống GET /api/leads.
// State giữ trong URL → export bám đúng filter + refresh/back giữ nguyên bộ lọc.

const features = tableFeatures({ rowSortingFeature, rowPaginationFeature })
const helper = createColumnHelper<typeof features, LeadRow>()
const EMPTY_ROWS: LeadRow[] = []

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function resolveUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
}

const columns = helper.columns([
  helper.accessor('fullName', {
    header: 'Name',
    cell: ({ row, getValue }) => (
      <Link
        href={`/leads/${row.original.id}`}
        className="font-medium text-zinc-100 hover:text-emerald-400"
      >
        {getValue() ?? '—'}
      </Link>
    ),
  }),
  helper.accessor('email', {
    header: 'Email',
    enableSorting: false,
    cell: ({ getValue }) => <span className="text-zinc-400">{getValue() ?? '—'}</span>,
  }),
  helper.accessor('companyName', {
    header: 'Company',
    cell: ({ getValue }) => <span className="text-zinc-200">{getValue() ?? '—'}</span>,
  }),
  helper.accessor('title', {
    header: 'Title',
    enableSorting: false,
    cell: ({ getValue }) => <span className="text-zinc-400">{getValue() ?? '—'}</span>,
  }),
  helper.accessor('industry', {
    header: 'Industry',
    enableSorting: false,
    cell: ({ getValue }) => {
      const v = getValue()
      if (!v) return <span className="text-zinc-600">—</span>
      const label = INDUSTRIES.find((i) => i.value === v)?.label ?? v
      return (
        <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{label}</span>
      )
    },
  }),
  helper.accessor('companySize', {
    header: 'Size',
    cell: ({ getValue }) => <span className="tabular-nums text-zinc-300">{getValue() ?? '—'}</span>,
  }),
  helper.accessor('phone', {
    header: 'Phone',
    enableSorting: false,
    cell: ({ row }) => {
      const { phone, phoneValid } = row.original
      if (!phone) return <span className="text-zinc-600">—</span>
      return (
        <span className="inline-flex items-center gap-1.5 tabular-nums text-zinc-300">
          {phone}
          <span
            className={`h-1.5 w-1.5 rounded-full ${phoneValid ? 'bg-emerald-400' : 'bg-zinc-600'}`}
            title={phoneValid ? 'Valid phone' : 'Unverified phone'}
          />
        </span>
      )
    },
  }),
  // Score: luồng E điền ở Batch 2 (join lead_scores). Batch 1 hiển thị placeholder, chưa sort.
  helper.display({
    id: 'score',
    header: 'Score',
    cell: () => (
      <span className="text-zinc-600" title="Scoring lands in Batch 2">
        —
      </span>
    ),
  }),
  helper.accessor('status', {
    header: 'Status',
    cell: ({ row }) => <StatusSelect leadId={row.original.id} status={row.original.status} />,
  }),
  helper.accessor('createdAt', {
    header: 'Created',
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-zinc-400">{formatDate(getValue())}</span>
    ),
  }),
  helper.display({
    id: 'actions',
    header: '',
    cell: ({ row }) => (
      <Link
        href={`/leads/${row.original.id}`}
        className="whitespace-nowrap text-emerald-400 hover:text-emerald-300"
      >
        View →
      </Link>
    ),
  }),
])

export function LeadsTable() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // ---- state đọc từ URL ----
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 25))
  const sort = searchParams.get('sort') ?? 'createdAt'
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc'
  const status = searchParams.get('status') ?? ''
  const industry = searchParams.get('industry') ?? ''
  const search = searchParams.get('search') ?? ''

  // ---- helper cập nhật URL ----
  const setParams = useCallback(
    (patch: Record<string, string | undefined>, resetPage = true) => {
      const next = new URLSearchParams(searchParams.toString())
      if (resetPage && !('page' in patch)) next.delete('page')
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  // ---- search có debounce ----
  const [searchInput, setSearchInput] = useState(search)
  // Sync local input khi URL 'search' đổi từ ngoài (Clear, back/forward) — điều chỉnh state
  // lúc render, không dùng effect (React docs: "you might not need an effect").
  const [prevSearch, setPrevSearch] = useState(search)
  if (search !== prevSearch) {
    setPrevSearch(search)
    setSearchInput(search)
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) setParams({ search: searchInput || undefined })
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput, search, setParams])

  // ---- data fetch (server-side) ----
  const qs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort, order })
    if (status) p.set('status', status)
    if (industry) p.set('industry', industry)
    if (search) p.set('search', search)
    return p.toString()
  }, [page, pageSize, sort, order, status, industry, search])

  const query = useQuery<LeadsResponse>({
    queryKey: ['leads', qs],
    queryFn: async () => {
      const res = await fetch(`/api/leads?${qs}`)
      if (!res.ok) throw new Error('Failed to load leads')
      return res.json()
    },
    placeholderData: keepPreviousData,
  })

  const total = query.data?.total ?? 0

  // ---- TanStack Table (controlled, manual) ----
  const sorting: SortingState = useMemo(() => [{ id: sort, desc: order === 'desc' }], [sort, order])
  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: page - 1, pageSize }),
    [page, pageSize],
  )

  const table = useTable({
    features,
    columns,
    data: query.data?.rows ?? EMPTY_ROWS,
    getRowId: (r) => r.id,
    rowCount: total,
    manualSorting: true,
    manualPagination: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      const next = resolveUpdater(updater, sorting)
      const first = next[0]
      setParams({ sort: first?.id ?? 'createdAt', order: first?.desc ? 'desc' : 'asc' })
    },
    onPaginationChange: (updater) => {
      const next = resolveUpdater(updater, pagination)
      setParams(
        { page: String(next.pageIndex + 1), pageSize: String(next.pageSize) },
        false,
      )
    },
  })

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const hasFilters = Boolean(status || industry || search)

  const exportQs = useMemo(() => {
    const p = new URLSearchParams({ sort, order })
    if (status) p.set('status', status)
    if (industry) p.set('industry', industry)
    if (search) p.set('search', search)
    return p.toString()
  }, [sort, order, status, industry, search])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name, email, company…"
          className="h-9 w-64 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => setParams({ status: e.target.value || undefined })}
          className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-200 focus:border-zinc-600 focus:outline-none"
        >
          <option value="">All statuses</option>
          {STATUS_FLOW.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={industry}
          onChange={(e) => setParams({ industry: e.target.value || undefined })}
          className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-200 focus:border-zinc-600 focus:outline-none"
        >
          <option value="">All industries</option>
          {INDUSTRIES.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            onClick={() => {
              setSearchInput('')
              setParams({ status: undefined, industry: undefined, search: undefined })
            }}
            className="h-9 rounded-lg px-2 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-zinc-500 tabular-nums">
            {total.toLocaleString('en-US')} leads
            {query.isFetching && <span className="ml-2 text-zinc-600">·  updating…</span>}
          </span>
          <a
            href={`/api/leads/export?${exportQs}`}
            className="inline-flex h-9 items-center rounded-lg bg-emerald-500 px-3 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-zinc-900/60">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-zinc-800">
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      className="px-3 py-2.5 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase"
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-zinc-300"
                        >
                          <table.FlexRender header={header} />
                          <span className="text-zinc-600">
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                          </span>
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {query.isError ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-rose-400">
                  Failed to load leads. Try again.
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-zinc-500">
                  {query.isLoading ? 'Loading…' : 'No leads match these filters.'}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-800/60 hover:bg-zinc-900/40">
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5 align-middle">
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
        <div className="tabular-nums">
          {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of{' '}
          {total.toLocaleString('en-US')}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-zinc-500">
            Rows
            <select
              value={pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 text-zinc-200 focus:border-zinc-600 focus:outline-none"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-8 rounded-lg border border-zinc-800 px-3 text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Prev
          </button>
          <span className="tabular-nums text-zinc-500">
            Page {page} / {pageCount}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-8 rounded-lg border border-zinc-800 px-3 text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
