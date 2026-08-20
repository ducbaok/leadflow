import { foldDiacritics } from '@/lib/normalize/text'
import type { ColumnMapping } from '../fields'
import type { AdapterRawRow, SourceAdapter } from './types'

// Apollo MOCK adapter: nguồn dữ liệu GIẢ LẬP shape của Apollo People API, KHÔNG gọi mạng.
// Điểm mấu chốt: dữ liệu Apollo → AdapterRawRow → đi qua pipeline staging import_rows chung.
// Apollo THẬT sẽ chỉ khác ở `fetchRows` (gọi https://api.apollo.io/v1/people/search + phân trang);
// `flattenApolloPerson`, `APOLLO_MAPPING` và toàn bộ pipeline phía sau giữ nguyên.

/** Subset các field của một person trong Apollo People API mà ta dùng. */
export type ApolloPerson = {
  id: string
  first_name: string
  last_name: string
  name: string
  title: string | null
  email: string | null
  email_status: 'verified' | 'guessed' | null
  organization: {
    name: string
    industry: string | null
    estimated_num_employees: number | null
    website_url: string | null
  } | null
  phone_numbers: { raw_number: string; type?: string }[]
}

// mapping từ header phẳng (do flatten đặt) → LeadField. `apollo_id` map null = cột bỏ qua
// (chứng minh mapping xử lý đúng cột không phải lead field).
export const APOLLO_MAPPING: ColumnMapping = {
  apollo_id: null,
  name: 'fullName',
  email: 'email',
  organization_name: 'companyName',
  title: 'title',
  industry: 'industry',
  employees: 'companySize',
  phone: 'phone',
}

/** Chuyển một ApolloPerson → AdapterRawRow (không gian cột mà APOLLO_MAPPING mô tả). */
export function flattenApolloPerson(p: ApolloPerson): AdapterRawRow {
  return {
    apollo_id: p.id,
    name: p.name ?? '',
    email: p.email ?? '',
    organization_name: p.organization?.name ?? '',
    title: p.title ?? '',
    industry: p.organization?.industry ?? '',
    employees:
      p.organization?.estimated_num_employees != null ? String(p.organization.estimated_num_employees) : '',
    phone: p.phone_numbers?.[0]?.raw_number ?? '',
  }
}

// ---- Nguồn giả lập DETERMINISTIC (index-based, không Math.random) ----

const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Võ']
const MIDDLE = ['Văn', 'Thị', 'Đức', 'Minh', 'Quang', 'Hồng']
const FIRST = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hùng', 'Khánh', 'Lan', 'Linh', 'Mai', 'Nam']
const TITLES = ['CFO', 'Kế toán trưởng', 'Head of Finance', 'CEO', 'CTO', 'Sales Manager', 'Procurement Manager']
const SIZES = [15, 20, 35, 50, 120, 200, 450, 700]
const COMPANIES: { name: string; domain: string; industry: string }[] = [
  { name: 'FPT Software', domain: 'fptsoftware.com', industry: 'software' },
  { name: 'Vinamilk', domain: 'vinamilk.com.vn', industry: 'manufacturing' },
  { name: 'Thế Giới Di Động', domain: 'tgdd.vn', industry: 'retail' },
  { name: 'Tiki', domain: 'tiki.vn', industry: 'ecommerce' },
  { name: 'Gemadept Logistics', domain: 'gemadept.com.vn', industry: 'logistics' },
  { name: 'Techcombank', domain: 'techcombank.com.vn', industry: 'fintech' },
]
const FREE_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com']

function vnPhone(i: number): string {
  const prefixes = ['090', '091', '093', '096', '097', '098', '070', '078']
  const prefix = prefixes[i % prefixes.length]
  const suffix = String(1000000 + ((i * 526153) % 9000000)) // 7 chữ số, deterministic
  return prefix + suffix
}

/**
 * Sinh `count` ApolloPerson deterministic. Có chủ đích cài EXACT DUPES: mỗi bội số 7
 * (từ i=7) lặp lại email của person trước đó với biến thể HOA/thường + tên khác — để chứng
 * minh dedupe exact ở promote gom lại (inserted < totalRows). Person đầu tiên không có email
 * (mọi bội số 11) đi nhánh no-email.
 */
export function mockApolloPeople(count = 50): ApolloPerson[] {
  const people: ApolloPerson[] = []
  for (let i = 0; i < count; i++) {
    const last = LAST[i % LAST.length]
    const middle = MIDDLE[(i * 3) % MIDDLE.length]
    const first = FIRST[(i * 5) % FIRST.length]
    const name = `${last} ${middle} ${first}`
    const company = COMPANIES[i % COMPANIES.length]
    const size = SIZES[(i * 2) % SIZES.length]
    const title = TITLES[(i * 4) % TITLES.length]

    const asciiLocal = foldDiacritics(`${first}.${last}`).toLowerCase().replace(/[^a-z.]/g, '')
    const useFree = i % 3 === 1
    const domain = useFree ? FREE_DOMAINS[i % FREE_DOMAINS.length] : company.domain
    let email: string | null = `${asciiLocal}${i}@${domain}`
    if (i > 0 && i % 11 === 0) email = null // vài lead thiếu email (Apollo cũng vậy)

    let person: ApolloPerson = {
      id: `apollo_${1000 + i}`,
      first_name: first,
      last_name: last,
      name,
      title,
      email,
      email_status: useFree ? 'guessed' : 'verified',
      organization: {
        name: company.name,
        industry: company.industry,
        estimated_num_employees: size,
        website_url: `https://${company.domain}`,
      },
      phone_numbers: i % 4 === 3 ? [] : [{ raw_number: vnPhone(i), type: 'work' }],
    }

    // Exact dupe chủ đích: lặp email của person[i-1] với biến thể HOA — promote phải gom.
    if (i >= 7 && i % 7 === 0) {
      const prev = people[i - 1]
      if (prev.email) {
        person = {
          ...person,
          id: `apollo_dup_${1000 + i}`,
          email: prev.email.toUpperCase(),
          name: foldDiacritics(prev.name), // tên biến thể (bỏ dấu) — cùng người
        }
      }
    }
    people.push(person)
  }
  return people
}

/**
 * Tạo Apollo mock adapter. Truyền sẵn `people` để test/demo; mặc định sinh 50 record giả lập.
 */
export function createApolloMockAdapter(people?: ApolloPerson[]): SourceAdapter {
  return {
    sourceType: 'apollo_mock',
    label: 'Apollo (mock)',
    mapping: APOLLO_MAPPING,
    async fetchRows(options) {
      const list = people ?? mockApolloPeople(options?.limit ?? 50)
      const limited = options?.limit != null ? list.slice(0, options.limit) : list
      return limited.map(flattenApolloPerson)
    },
  }
}
