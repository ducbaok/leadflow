/**
 * Seed data cho demo — brief §7.5: "Dashboard trống = portfolio chết".
 * Sinh ~5.000 lead giả (Faker, seed cố định = deterministic) và CÀI DUPES CHỦ ĐÍCH:
 *   - ~250 lead có nhiều bản ghi nguồn (exact dupes đã được gom khi "import")
 *   - ~150 cặp fuzzy dupes (bản ghi riêng, chờ luồng D flag)
 *   - vài lead tên bắt đầu bằng = + - @ để demo chống CSV injection khi export
 * Dùng chung bởi `npm run seed` (scripts/seed.ts) và `POST /api/admin/reset` (luồng G, ADR-009)
 * — nên nằm trong src/ chứ không phải scripts/, và @faker-js/faker là runtime dependency.
 */
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { faker } from '@faker-js/faker'
import { getDb, type Db } from '@/db/client'
import { importBatches, leadSources, leads, scoringConfig } from '@/db/schema'
import { normalizeEmail } from '@/lib/normalize/email'
import { validatePhone } from '@/lib/normalize/phone'
import { foldDiacritics, normalizeCompany, normalizePersonName, sortNameTokens } from '@/lib/normalize/text'

// ---------- dữ liệu nền kiểu VN ----------
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý']
const MIDDLE = ['Văn', 'Thị', 'Đức', 'Minh', 'Quang', 'Hồng', 'Thanh', 'Xuân', 'Hữu', 'Ngọc', 'Thu', 'Bá']
const GIVEN = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hùng', 'Khánh', 'Lan', 'Linh', 'Mai', 'Nam', 'Oanh', 'Phúc', 'Quân', 'Sơn', 'Tâm', 'Tuấn', 'Uyên', 'Việt', 'Yến', 'Trang', 'Hiếu', 'Long', 'Nga', 'Trường', 'Hải', 'Loan']

const COMPANIES = [
  'FPT Software', 'VNG Corporation', 'Tiki', 'MoMo', 'Shopee Vietnam', 'Grab Vietnam', 'Techcombank', 'VPBank',
  'Viettel Solutions', 'VNPT Technology', 'Haravan', 'KiotViet', 'Base.vn', 'Sapo', 'Nhanh.vn', 'Giao Hàng Nhanh',
  'Vinamilk', 'Masan Group', 'Thế Giới Di Động', 'PNJ', 'Hoà Phát', 'Vingroup', 'Sun Group', 'Novaland',
  'An Phát Holdings', 'Minh Long Ceramics', 'Bitis', 'Trung Nguyên Legend', 'Highlands Coffee', 'The Coffee House',
  'Elise Fashion', 'Canifa', 'Juno', 'Con Cưng', 'Pharmacity', 'Long Châu Pharma', 'Guardian Vietnam',
  'Gemadept Logistics', 'Transimex', 'Bee Logistics', 'Sotrans', 'ALS Aviation Logistics',
  'TopCV', 'VietnamWorks', 'Anphabe', 'Got It Vietnam', 'ELSA Speak', 'Topica Edtech', 'Teky Academy',
  'Vinmec', 'Medlatec', 'Nhi Dong 315', 'Jio Health', 'BuyMed', 'POC Pharma',
  'CenLand', 'Dat Xanh Group', 'Hung Thinh Corp', 'An Gia Investment', 'DKRA Vietnam',
  'Yeah1 Group', 'VCCorp', 'Zalo', 'Baomoi Media', 'Schannel Network',
  'Saigon Precision', 'Duy Tan Plastics', 'Rang Dong Light', 'Cadivi Cables', 'Thaco Industries',
  'Vinatex', 'May 10 Garment', 'TNG Investment', 'Phong Phu Corp', 'Viet Tien Garment',
]

const INDUSTRIES = ['software', 'fintech', 'ecommerce', 'manufacturing', 'retail', 'logistics', 'education', 'healthcare', 'real_estate', 'media']
const COMPANY_INDUSTRY: Record<string, string> = {} // gán ổn định công ty → ngành
const TITLES = [
  'CEO', 'CTO', 'CFO', 'COO', 'Founder', 'Co-Founder',
  'Kế toán trưởng', 'Head of Finance', 'Finance Director', 'Head of Finance Operations',
  'Sales Director', 'Sales Manager', 'Business Development Manager',
  'Marketing Manager', 'Head of Marketing', 'Growth Lead',
  'Operations Manager', 'Procurement Manager', 'Supply Chain Manager',
  'HR Director', 'HR Manager', 'Product Manager', 'Engineering Manager', 'IT Manager',
]
const SIZES = [5, 10, 15, 20, 35, 50, 80, 120, 200, 300, 450, 700, 1200, 3000]
const FREE_DOMAINS = ['gmail.com', 'gmail.com', 'gmail.com', 'yahoo.com', 'outlook.com']

function companyDomain(company: string): string {
  const slug = foldDiacritics(company).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14)
  return `${slug}${faker.helpers.arrayElement(['.vn', '.com', '.com.vn'])}`
}

function vnPhone(): string {
  const prefix = faker.helpers.arrayElement(['090', '091', '093', '096', '097', '098', '032', '033', '035', '070', '076', '078', '086', '089'])
  return prefix + faker.string.numeric(7)
}

type SeedLead = {
  id: string
  email: string | null
  fullName: string
  companyName: string
  title: string
  industry: string
  companySize: number
  phone: string | null
  status: 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
  createdAt: Date
  sources: Array<Record<string, string>> // raw variants — nhiều bản = exact dupe đã gom
}

const usedEmails = new Set<string>()

function makeLead(i: number): SeedLead {
  const last = faker.helpers.arrayElement(LAST)
  const middle = faker.helpers.arrayElement(MIDDLE)
  const given = faker.helpers.arrayElement(GIVEN)
  const fullName = `${last} ${middle} ${given}`
  const company = faker.helpers.arrayElement(COMPANIES)
  COMPANY_INDUSTRY[company] ??= faker.helpers.arrayElement(INDUSTRIES)

  // ~78% có email; 30% trong đó dùng free mail
  let email: string | null = null
  if (faker.number.int(99) < 78) {
    const ascii = foldDiacritics(`${given}.${middle}.${last}`).toLowerCase().replace(/[^a-z.]/g, '')
    const free = faker.number.int(99) < 30
    const domain = free ? faker.helpers.arrayElement(FREE_DOMAINS) : companyDomain(company)
    email = `${ascii}${i}@${domain}`
    const norm = normalizeEmail(email)
    if (!norm || usedEmails.has(norm)) email = `${ascii}.${i}.${faker.string.alphanumeric(4).toLowerCase()}@${domain}`
    usedEmails.add(normalizeEmail(email)!)
  }

  const phoneRoll = faker.number.int(99)
  const phone = phoneRoll < 85 ? vnPhone() : phoneRoll < 95 ? null : faker.string.numeric(5)

  const status = faker.helpers.weightedArrayElement([
    { weight: 55, value: 'new' as const },
    { weight: 20, value: 'contacted' as const },
    { weight: 12, value: 'qualified' as const },
    { weight: 6, value: 'won' as const },
    { weight: 7, value: 'lost' as const },
  ])

  const raw: Record<string, string> = {
    full_name: fullName,
    email: email ?? '',
    company: company,
    title: '',
    industry: COMPANY_INDUSTRY[company],
    company_size: '',
    phone: phone ?? '',
  }
  const title = faker.helpers.arrayElement(TITLES)
  const companySize = faker.helpers.arrayElement(SIZES)
  raw.title = title
  raw.company_size = String(companySize)

  return {
    id: randomUUID(),
    email,
    fullName,
    companyName: company,
    title,
    industry: COMPANY_INDUSTRY[company],
    companySize,
    phone,
    status,
    createdAt: faker.date.recent({ days: 180 }),
    sources: [raw],
  }
}

// Cấu hình scoring mặc định của bộ demo. Phái sinh từ 30-scoring-spec §1 (giống DEFAULT_RULES
// trong src/lib/scoring/constants.ts — hai nơi, một nguồn sự thật là file SoT).
const DEMO_ICP =
  'Chúng tôi bán phần mềm quản lý tài chính cho doanh nghiệp vừa (20–500 nhân sự) ngành sản xuất, bán lẻ, thương mại điện tử tại Việt Nam. Người quyết định mua thường là CFO, Kế toán trưởng hoặc Head of Finance. Công ty đang tăng trưởng, vừa gọi vốn hoặc mở rộng chi nhánh là tín hiệu tốt.'

const DEMO_RULES = {
  version: 1,
  rules: [
    { field: 'title', op: 'contains_any', values: ['cfo', 'chief financial', 'finance director', 'ke toan truong', 'head of finance'], points: 30 },
    { field: 'companySize', op: 'between', min: 20, max: 500, points: 25 },
    { field: 'industry', op: 'in', values: ['manufacturing', 'retail', 'ecommerce'], points: 15 },
    { field: 'phoneValid', op: 'equals', value: true, points: 10 },
    { field: 'email', op: 'is_company_domain', points: 10 },
  ],
}

const DEMO_AI_TOP_N = 200

export type SeedResult = { leads: number; multiSource: number; fuzzy: number; injection: number }

/**
 * XOÁ TOÀN BỘ dữ liệu rồi sinh lại bộ demo. Deterministic: faker.seed(42) + state cục bộ
 * được reset mỗi lần gọi, nên gọi lần thứ N cho ra đúng bộ dữ liệu như lần đầu.
 */
export async function seedDemoData(db: Db = getDb(), log: (msg: string) => void = () => {}): Promise<SeedResult> {
  faker.seed(42)
  usedEmails.clear()
  for (const k of Object.keys(COMPANY_INDUSTRY)) delete COMPANY_INDUSTRY[k]

  log('→ Xoá dữ liệu cũ...')
  await db.execute(sql`TRUNCATE lead_scores, dedupe_pairs, lead_sources, import_rows, audit_log, leads, import_batches RESTART IDENTITY CASCADE`)

  log('→ Sinh 5.000 lead nền...')
  const all: SeedLead[] = []
  for (let i = 0; i < 5000; i++) all.push(makeLead(i))

  // --- exact dupes đã gom: ~250 lead có 2-3 bản ghi nguồn với biến thể raw ---
  const multiSource = faker.helpers.arrayElements(all.filter((l) => l.email), 250)
  for (const lead of multiSource) {
    const n = faker.number.int({ min: 1, max: 2 })
    for (let k = 0; k < n; k++) {
      const base = lead.sources[0]
      const emailVariant =
        lead.email && lead.email.endsWith('@gmail.com')
          ? faker.helpers.arrayElement([lead.email.toUpperCase(), lead.email.replace(/\./g, (m, idx) => (idx < lead.email!.indexOf('@') ? '' : m)), lead.email.replace('@', `+news${k}@`)])
          : (lead.email ?? '').toUpperCase()
      lead.sources.push({
        ...base,
        full_name: k % 2 === 0 ? foldDiacritics(lead.fullName) : lead.fullName.toUpperCase(),
        email: emailVariant,
        company: k % 2 === 0 ? `${lead.companyName} Ltd.` : lead.companyName,
      })
    }
  }

  // --- fuzzy dupes: ~150 bản ghi lead RIÊNG, chờ luồng D flag ---
  log('→ Cài 150 cặp fuzzy dupes chủ đích...')
  const fuzzyBases = faker.helpers.arrayElements(all, 150)
  const fuzzyClones: SeedLead[] = fuzzyBases.map((base) => {
    const variantName = faker.helpers.arrayElement([foldDiacritics(base.fullName), base.fullName])
    const variantCompany = faker.helpers.arrayElement([`${base.companyName} Ltd.`, `${base.companyName} JSC`, foldDiacritics(base.companyName), base.companyName.split(' ')[0]])
    const raw: Record<string, string> = {
      full_name: variantName, email: '', company: variantCompany, title: base.title,
      industry: base.industry, company_size: String(base.companySize), phone: '',
    }
    return {
      id: randomUUID(),
      email: null, // khác/thiếu email → exact dedupe không gom được, đúng vai fuzzy
      fullName: variantName,
      companyName: variantCompany,
      title: base.title,
      industry: base.industry,
      companySize: base.companySize,
      phone: null,
      status: 'new' as const,
      createdAt: faker.date.recent({ days: 60 }),
      sources: [raw],
    }
  })
  all.push(...fuzzyClones)

  // --- CSV injection demo: tên bắt đầu bằng ký tự công thức Excel ---
  const injection = ['=HYPERLINK("https://evil.example","Nguyen Van A")', '+84 Nguyen Injected', '-Tran Formula', '@Le Command'].map((name, k) => {
    const raw: Record<string, string> = { full_name: name, email: `inject${k}@test-injection.vn`, company: 'Injection Test Co', title: 'QA', industry: 'software', company_size: '10', phone: '' }
    return {
      id: randomUUID(), email: `inject${k}@test-injection.vn`, fullName: name, companyName: 'Injection Test Co',
      title: 'QA', industry: 'software', companySize: 10, phone: null, status: 'new' as const,
      createdAt: new Date('2026-08-01T00:00:00Z'), sources: [raw],
    } satisfies SeedLead
  })
  all.push(...injection)

  log(`→ Insert ${all.length} leads...`)
  const batchId = randomUUID()
  await db.insert(importBatches).values({
    id: batchId, filename: 'seed', sourceType: 'seed', status: 'completed',
    totalRows: all.reduce((s, l) => s + l.sources.length, 0),
    validRows: all.reduce((s, l) => s + l.sources.length, 0),
    errorRows: 0, insertedLeads: all.length, updatedLeads: 0,
    startedAt: new Date(), finishedAt: new Date(), durationMs: 0,
  })

  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500)
    await db.insert(leads).values(
      chunk.map((l) => ({
        id: l.id,
        email: l.email,
        emailNormalized: normalizeEmail(l.email),
        fullName: l.fullName,
        fullNameNormalized: normalizePersonName(l.fullName),
        fullNameSorted: sortNameTokens(normalizePersonName(l.fullName) ?? ''),
        companyName: l.companyName,
        companyNameNormalized: normalizeCompany(l.companyName),
        title: l.title,
        industry: l.industry,
        companySize: l.companySize,
        phone: l.phone,
        phoneValid: validatePhone(l.phone),
        status: l.status,
        createdAt: l.createdAt,
        updatedAt: l.createdAt,
      })),
    )
    const sourceRows = chunk.flatMap((l, idx) =>
      l.sources.map((raw, k) => ({
        leadId: l.id, importBatchId: batchId, sourceType: 'seed', rowNumber: i + idx + k, rawData: raw,
      })),
    )
    await db.insert(leadSources).values(sourceRows)
  }

  log('→ Scoring config mặc định...')
  await db
    .insert(scoringConfig)
    .values({ id: 1, icpDescription: DEMO_ICP, rules: DEMO_RULES, aiTopN: DEMO_AI_TOP_N })
    // Ghi đè TOÀN BỘ, không chỉ updatedAt: scoring_config nằm ngoài TRUNCATE ở trên (nó không có
    // FK tới leads), nên nếu chỉ chạm updatedAt thì rule/ICP/aiTopN mà khách tham quan sửa trên
    // /settings sẽ sống mãi — reset demo mất tác dụng đúng ở chỗ nó cần có tác dụng nhất.
    .onConflictDoUpdate({
      target: scoringConfig.id,
      set: { icpDescription: DEMO_ICP, rules: DEMO_RULES, aiTopN: DEMO_AI_TOP_N, updatedAt: new Date() },
    })

  const multiSourceCount = all.filter((l) => l.sources.length > 1).length
  log(`✓ Seed xong: ${all.length} leads (${multiSourceCount} lead nhiều nguồn, ${fuzzyClones.length} fuzzy dupes, ${injection.length} injection demo)`)
  return { leads: all.length, multiSource: multiSourceCount, fuzzy: fuzzyClones.length, injection: injection.length }
}
