import { describe, expect, it } from 'vitest'
import {
  APOLLO_MAPPING,
  createApolloMockAdapter,
  flattenApolloPerson,
  mockApolloPeople,
  type ApolloPerson,
} from '@/lib/import/adapters/apollo-mock'
import { invertMapping, normalizeMappedRow } from '@/lib/import/normalize-row'

// Adapter đúng interface = dữ liệu Apollo, sau khi flatten, chạy qua CHÍNH normalize của luồng A
// (không đường ghi lead riêng). Test này DB-free: kiểm transform + normalize + exact dedupe ở
// mức email_normalized (promote gom theo đúng khóa này). E2E qua DB verify riêng ở dev.

const INV = invertMapping(APOLLO_MAPPING)

function basePerson(o: Partial<ApolloPerson> = {}): ApolloPerson {
  return {
    id: 'apollo_1',
    first_name: 'An',
    last_name: 'Nguyễn',
    name: 'Nguyễn Văn An',
    title: 'CFO',
    email: 'an.nguyen@fptsoftware.com',
    email_status: 'verified',
    organization: {
      name: 'FPT Software',
      industry: 'software',
      estimated_num_employees: 200,
      website_url: 'https://fptsoftware.com',
    },
    phone_numbers: [{ raw_number: '0901234567' }],
    ...o,
  }
}

describe('flattenApolloPerson — chuyển shape Apollo → AdapterRawRow', () => {
  it('map đúng các field sang không gian cột của APOLLO_MAPPING', () => {
    const raw = flattenApolloPerson(basePerson())
    expect(raw.name).toBe('Nguyễn Văn An')
    expect(raw.email).toBe('an.nguyen@fptsoftware.com')
    expect(raw.organization_name).toBe('FPT Software')
    expect(raw.title).toBe('CFO')
    expect(raw.industry).toBe('software')
    expect(raw.employees).toBe('200')
    expect(raw.phone).toBe('0901234567')
    expect(raw.apollo_id).toBe('apollo_1')
  })

  it('field thiếu (organization null, không phone) → chuỗi rỗng, không crash', () => {
    const raw = flattenApolloPerson(basePerson({ organization: null, phone_numbers: [], email: null }))
    expect(raw.organization_name).toBe('')
    expect(raw.industry).toBe('')
    expect(raw.employees).toBe('')
    expect(raw.phone).toBe('')
    expect(raw.email).toBe('')
  })
})

describe('AdapterRawRow của Apollo đi qua normalize của luồng A', () => {
  it('normalize đúng: company_size số, tên fold dấu, email giữ, apollo_id bị bỏ qua (mapping null)', () => {
    const r = normalizeMappedRow(flattenApolloPerson(basePerson()), INV)
    expect(r.company_name).toBe('FPT Software')
    expect(r.company_name_normalized).toBe('fpt software')
    expect(r.company_size).toBe(200)
    expect(r.full_name).toBe('Nguyễn Văn An')
    expect(r.full_name_normalized).toBe('nguyen van an')
    expect(r.email).toBe('an.nguyen@fptsoftware.com')
    expect(r.email_normalized).toBe('an.nguyen@fptsoftware.com')
    expect(r.phone_valid).toBe(true)
    expect(r.validation_error).toBeNull()
  })

  it('exact dedupe: cùng email khác HOA/thường → cùng email_normalized (promote sẽ gom)', () => {
    const a = normalizeMappedRow(flattenApolloPerson(basePerson({ email: 'ke.toan@vinamilk.com.vn' })), INV)
    const b = normalizeMappedRow(flattenApolloPerson(basePerson({ email: 'KE.TOAN@VINAMILK.COM.VN' })), INV)
    expect(a.email_normalized).not.toBeNull()
    expect(a.email_normalized).toBe(b.email_normalized)
  })

  it('person thiếu email → lead-không-email hợp lệ (ADR-002), không lỗi dòng', () => {
    const r = normalizeMappedRow(flattenApolloPerson(basePerson({ email: null })), INV)
    expect(r.email_normalized).toBeNull()
    expect(r.validation_error).toBeNull()
  })
})

describe('mockApolloPeople — nguồn giả lập', () => {
  it('deterministic: hai lần gọi cho kết quả giống hệt', () => {
    expect(mockApolloPeople(30)).toEqual(mockApolloPeople(30))
  })

  it('cài sẵn exact dupe: có ít nhất một email_normalized lặp lại trong tập sinh ra', () => {
    const norms = mockApolloPeople(50)
      .map((p) => normalizeMappedRow(flattenApolloPerson(p), INV).email_normalized)
      .filter((e): e is string => e !== null)
    expect(norms.length).toBeGreaterThan(new Set(norms).size)
  })
})

describe('createApolloMockAdapter — implement SourceAdapter', () => {
  it('khai báo sourceType + mapping đúng, fetchRows tôn trọng limit', async () => {
    const adapter = createApolloMockAdapter()
    expect(adapter.sourceType).toBe('apollo_mock')
    expect(adapter.mapping).toBe(APOLLO_MAPPING)

    const rows = await adapter.fetchRows({ limit: 5 })
    expect(rows).toHaveLength(5)
    expect(Object.keys(rows[0])).toEqual(
      expect.arrayContaining(['name', 'email', 'organization_name', 'title', 'industry', 'employees', 'phone']),
    )
  })
})
