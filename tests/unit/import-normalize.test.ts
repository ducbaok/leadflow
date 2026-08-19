import { describe, expect, it } from 'vitest'
import { invertMapping, normalizeMappedRow } from '@/lib/import/normalize-row'
import type { ColumnMapping } from '@/lib/import/fields'
import golden from '../fixtures/golden-pairs.json'

// inv chuẩn cho CSV kiểu leads-clean
const INV = invertMapping({
  full_name: 'fullName',
  email: 'email',
  company: 'companyName',
  title: 'title',
  industry: 'industry',
  company_size: 'companySize',
  phone: 'phone',
} as ColumnMapping)

function row(overrides: Record<string, string>) {
  return normalizeMappedRow(
    { full_name: '', email: '', company: '', title: '', industry: '', company_size: '', phone: '', ...overrides },
    INV,
  )
}

describe('normalizeMappedRow — validation policy (luồng A)', () => {
  it('email thiếu (trống) → KHÔNG lỗi, import lead-không-email (ADR-002 / AC-4)', () => {
    const r = row({ full_name: 'Nguyễn Văn An', company: 'FPT' })
    expect(r.email_normalized).toBeNull()
    expect(r.validation_error).toBeNull()
    expect(r.full_name_normalized).toBe('nguyen van an')
  })

  it('email CÓ nhưng sai định dạng → dòng lỗi', () => {
    const r = row({ email: 'khong-phai-email', full_name: 'A' })
    expect(r.email_normalized).toBeNull()
    expect(r.validation_error).toMatch(/không hợp lệ/i)
  })

  it('email + tên + công ty đều trống → dòng lỗi (thiếu định danh)', () => {
    const r = row({ phone: '0912345678' })
    expect(r.validation_error).toMatch(/thiếu thông tin định danh/i)
  })

  it('phone sai → phone_valid=false, KHÔNG phải lỗi dòng', () => {
    const r = row({ full_name: 'A', phone: '123' })
    expect(r.phone_valid).toBe(false)
    expect(r.validation_error).toBeNull()
  })

  it('company_size không phải số → null, không lỗi', () => {
    expect(row({ full_name: 'A', company_size: 'hai trăm' }).company_size).toBeNull()
    expect(row({ full_name: 'A', company_size: '200' }).company_size).toBe(200)
    expect(row({ full_name: 'A', company_size: '1,500 nhân sự' }).company_size).toBe(1500)
  })

  it('normalize gmail (bỏ dấu chấm / +suffix) đúng khi promote', () => {
    expect(row({ email: 'nguyen.van.an@gmail.com' }).email_normalized).toBe('nguyenvanan@gmail.com')
    expect(row({ email: 'lan.pham+crm@gmail.com' }).email_normalized).toBe('lanpham@gmail.com')
  })

  it('giữ nguyên email hiển thị (raw trimmed) ở cột email', () => {
    expect(row({ email: '  Minh.Tran@FPT.com.vn ' }).email).toBe('Minh.Tran@FPT.com.vn')
  })
})

describe('AC-9 — cặp exact trong golden-pairs gom đúng ngay từ import', () => {
  const exactPairs = (golden.pairs as { id: number; kind: string; a: { email?: string }; b: { email?: string } }[]).filter(
    (p) => p.kind === 'exact',
  )

  it('mọi cặp exact: email_normalized của a === b (và không null)', () => {
    expect(exactPairs.length).toBeGreaterThan(0)
    for (const p of exactPairs) {
      const na = row({ email: p.a.email ?? '' }).email_normalized
      const nb = row({ email: p.b.email ?? '' }).email_normalized
      expect(na, `pair #${p.id} a`).not.toBeNull()
      expect(nb, `pair #${p.id} b`).not.toBeNull()
      expect(na, `pair #${p.id}`).toBe(nb)
    }
  })

  it('ranh giới gmail rule: cặp #10 (fptsoft.vn) KHÔNG gom bằng email (dot rule chỉ cho gmail)', () => {
    const p10 = golden.pairs.find((p) => p.id === 10)!
    const na = row({ email: (p10.a as { email?: string }).email ?? '' }).email_normalized
    const nb = row({ email: (p10.b as { email?: string }).email ?? '' }).email_normalized
    expect(na).not.toBe(nb)
  })
})
