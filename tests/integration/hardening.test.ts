import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { auditLog, importBatches, importRows, leads } from '@/db/schema'
import { MAX_UPLOAD_BYTES } from '@/lib/import/parse'
import { closeDb, getDrizzle, hasDb } from './helpers/db'

// Hardening (task 4): giới hạn upload, CSV injection end-to-end, và rà audit trên route mutation THẬT.
// Gọi thẳng route handler của Next (không cần server chạy) → kiểm chứng đúng code luồng A/B.

afterAll(closeDb)

// ────────────────────────────────────────────────────────────────────────────
// 1) Giới hạn kích thước upload (SoT 00-scope §non-functional: 20MB) — POST /api/imports.
//    Các nhánh 413/400/415 return TRƯỚC khi chạm DB → không cần Postgres.
// ────────────────────────────────────────────────────────────────────────────
describe('hardening — giới hạn upload POST /api/imports', () => {
  async function postFile(file: File | null) {
    const { POST } = await import('@/app/api/imports/route')
    const fd = new FormData()
    if (file) fd.append('file', file)
    return POST(new Request('http://localhost/api/imports', { method: 'POST', body: fd }))
  }

  it(`file > ${MAX_UPLOAD_BYTES / 1024 / 1024}MB → 413 (không stage vào DB)`, async () => {
    const oversized = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1024)], 'big.csv', { type: 'text/csv' })
    const res = await postFile(oversized)
    expect(res.status).toBe(413)
    expect((await res.json()).error).toMatch(/20MB/)
  })

  it('file rỗng → 400', async () => {
    const res = await postFile(new File([], 'empty.csv', { type: 'text/csv' }))
    expect(res.status).toBe(400)
  })

  it('không phải .csv (đuôi + MIME đều không hợp lệ) → 415', async () => {
    // Route CHẤP NHẬN text/plain như CSV-like (chủ ý) → phải dùng type/đuôi khác hẳn để bị chặn.
    const res = await postFile(new File([new Uint8Array([1, 2, 3])], 'notes.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(415)
  })

  it('thiếu trường file → 400', async () => {
    const res = await postFile(null)
    expect(res.status).toBe(400)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) CSV injection END-TO-END qua GET /api/leads/export trên dữ liệu seed thật (AC-6).
//    Parse CSV bằng papaparse (xử lý quote đúng) rồi assert KHÔNG ô data nào mở đầu = + - @.
// ────────────────────────────────────────────────────────────────────────────
describe.skipIf(!hasDb)('hardening — CSV injection end-to-end (export route thật)', () => {
  let injectionCount = 0
  beforeAll(async () => {
    // 4 lead injection do seed cài (tên bắt đầu = + - @, company 'Injection Test Co').
    const rows = (await getDrizzle().execute(
      sql`SELECT count(*)::int AS c FROM leads WHERE company_name ILIKE '%Injection%'`,
    )) as unknown as { c: number }[]
    injectionCount = rows[0]?.c ?? 0
  })

  async function exportCsv(search: string): Promise<string> {
    const { GET } = await import('@/app/api/leads/export/route')
    const res = await GET(new NextRequest(`http://localhost/api/leads/export?search=${encodeURIComponent(search)}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    return res.text()
  }

  it('mọi ô data trong export KHÔNG bắt đầu bằng ký tự formula (parse chuẩn RFC 4180)', async () => {
    if (injectionCount === 0) {
      // Seed chưa nạp 4 lead injection → không có gì để chứng minh, đánh dấu skip runtime.
      console.warn('[hardening] bỏ qua: seed injection leads không có (chạy `npm run seed`)')
      return
    }
    const csv = await exportCsv('Injection')
    const parsed = Papa.parse<string[]>(csv.replace(/^﻿/, ''), { skipEmptyLines: true })
    const dataRows = (parsed.data as string[][]).slice(1) // bỏ header
    expect(dataRows.length).toBeGreaterThanOrEqual(injectionCount)

    for (const row of dataRows) {
      for (const cell of row) {
        expect(/^[=+\-@]/.test(cell), `ô "${cell.slice(0, 30)}" không được mở đầu bằng formula`).toBe(false)
      }
    }
    // Chứng cứ dương: giá trị nguy hiểm =HYPERLINK vẫn có mặt nhưng đã bị prefix ' (vô hiệu hoá).
    expect(csv).toContain("'=HYPERLINK")
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) Rà audit trail: route mutation THẬT ghi audit_log (SoT 10-data-model §audit_log).
//    Kiểm chứng bằng cách chạy route rồi tìm entry — dọn sạch sau đó.
// ────────────────────────────────────────────────────────────────────────────
describe.skipIf(!hasDb)('hardening — audit trail trên route mutation', () => {
  const RUN = crypto.randomUUID().slice(0, 8)
  const createdLeadIds: string[] = []
  const createdBatchIds: string[] = []

  afterAll(async () => {
    const db = getDrizzle()
    for (const id of createdLeadIds) {
      await db.delete(auditLog).where(eq(auditLog.entityId, id))
      await db.delete(leads).where(eq(leads.id, id))
    }
    for (const id of createdBatchIds) {
      await db.delete(auditLog).where(eq(auditLog.entityId, id))
      await db.delete(importRows).where(eq(importRows.batchId, id))
      await db.delete(importBatches).where(eq(importBatches.id, id))
    }
  })

  it('PATCH /api/leads/:id đổi status → ghi audit lead.status_changed', async () => {
    const db = getDrizzle()
    const [lead] = await db
      .insert(leads)
      .values({ email: `audit.${RUN}@example.test`, emailNormalized: `audit.${RUN}@example.test`, fullName: 'Audit Probe', status: 'new' })
      .returning({ id: leads.id })
    createdLeadIds.push(lead.id)

    const { PATCH } = await import('@/app/api/leads/[id]/route')
    const req = new NextRequest(`http://localhost/api/leads/${lead.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'contacted' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: lead.id }) })
    expect(res.status).toBe(200)

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, lead.id), eq(auditLog.action, 'lead.status_changed')))
    expect(audits.length).toBe(1)
    expect(audits[0].entity).toBe('lead')
    expect((audits[0].payload as { to?: string })?.to).toBe('contacted')
  })

  it('POST /api/imports upload → ghi audit import.uploaded', async () => {
    const { POST } = await import('@/app/api/imports/route')
    const csv = 'full_name,email,company\nNguyen Van A,a.' + RUN + '@example.test,FPT\n'
    const fd = new FormData()
    fd.append('file', new File([new TextEncoder().encode(csv)], `audit-${RUN}.csv`, { type: 'text/csv' }))
    const res = await POST(new Request('http://localhost/api/imports', { method: 'POST', body: fd }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { batchId: string }
    createdBatchIds.push(body.batchId)

    const db = getDrizzle()
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, body.batchId), eq(auditLog.action, 'import.uploaded')))
    expect(audits.length).toBe(1)
    expect(audits[0].entity).toBe('import_batch')
  })
})
