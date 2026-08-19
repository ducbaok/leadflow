/**
 * Sinh 3 file CSV mẫu vào public/samples/ để người xem portfolio tải về import thử:
 *   - leads-clean.csv  : 500 dòng sạch (happy path)
 *   - leads-messy.csv  : 300 dòng, header đặt tên khác (test mapping UI), ~45 dòng lỗi chủ đích
 *   - leads-10k.csv    : 10.000 dòng benchmark (AC-1); 500 dòng đầu trùng leads-clean.csv
 *                        (demo idempotency) + ~200 biến thể gmail-dot (demo dedupe trong file)
 * Không cần DB. Chạy: npm run samples
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { faker } from '@faker-js/faker'
import Papa from 'papaparse'
import { foldDiacritics } from '../src/lib/normalize/text'

faker.seed(7)

const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý']
const MIDDLE = ['Văn', 'Thị', 'Đức', 'Minh', 'Quang', 'Hồng', 'Thanh', 'Xuân', 'Hữu', 'Ngọc']
const GIVEN = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hùng', 'Khánh', 'Lan', 'Linh', 'Mai', 'Nam', 'Oanh', 'Phúc', 'Quân', 'Sơn', 'Tâm', 'Tuấn', 'Việt', 'Trang']
const COMPANIES = ['FPT Software', 'VNG Corporation', 'Tiki', 'MoMo', 'Shopee Vietnam', 'Haravan', 'KiotViet', 'Base.vn', 'Vinamilk', 'PNJ', 'Hoà Phát', 'Gemadept Logistics', 'TopCV', 'Vinmec', 'CenLand', 'Duy Tan Plastics', 'Viet Tien Garment', 'The Coffee House', 'Pharmacity', 'Thaco Industries']
const INDUSTRIES = ['software', 'fintech', 'ecommerce', 'manufacturing', 'retail', 'logistics', 'education', 'healthcare']
const TITLES = ['CEO', 'CTO', 'CFO', 'Kế toán trưởng', 'Head of Finance', 'Sales Director', 'Marketing Manager', 'Operations Manager', 'Procurement Manager', 'Product Manager']

type Row = { full_name: string; email: string; company: string; title: string; industry: string; company_size: string; phone: string }

function vnPhone(): string {
  return faker.helpers.arrayElement(['090', '091', '093', '096', '097', '032', '035', '070', '086']) + faker.string.numeric(7)
}

function makeRow(i: number): Row {
  const fullName = `${faker.helpers.arrayElement(LAST)} ${faker.helpers.arrayElement(MIDDLE)} ${faker.helpers.arrayElement(GIVEN)}`
  const company = faker.helpers.arrayElement(COMPANIES)
  const slug = foldDiacritics(company).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  const local = foldDiacritics(fullName).toLowerCase().replace(/\s+/g, '.')
  const gmail = faker.number.int(99) < 30
  return {
    full_name: fullName,
    email: gmail ? `${local}.${i}@gmail.com` : `${local}.${i}@${slug}.vn`,
    company,
    title: faker.helpers.arrayElement(TITLES),
    industry: faker.helpers.arrayElement(INDUSTRIES),
    company_size: String(faker.helpers.arrayElement([10, 25, 50, 120, 250, 500, 1500])),
    phone: vnPhone(),
  }
}

const outDir = path.join(process.cwd(), 'public', 'samples')
mkdirSync(outDir, { recursive: true })

// ---------- leads-clean.csv ----------
const clean: Row[] = Array.from({ length: 500 }, (_, i) => makeRow(i))
writeFileSync(path.join(outDir, 'leads-clean.csv'), Papa.unparse(clean), 'utf8')

// ---------- leads-messy.csv (header khác + dòng lỗi chủ đích) ----------
const messy = Array.from({ length: 300 }, (_, i) => {
  const r = makeRow(1000 + i)
  const roll = i % 20
  if (roll === 0) r.email = 'khong-phai-email' // email sai định dạng
  if (roll === 1) r.email = '' // thiếu email (vẫn phải import được — ADR-002)
  if (roll === 2) r.phone = '123' // phone sai
  if (roll === 3) r.full_name = '' // thiếu tên
  if (roll === 4) r.full_name = '=HYPERLINK("https://evil.example","Click")' // CSV injection
  if (roll === 5) r.company_size = 'hai trăm' // size không phải số
  return {
    'Họ và tên': r.full_name,
    'E-mail Address': r.email,
    'Company Name': r.company,
    'Job Title': r.title,
    'Nganh': r.industry,
    'Size': r.company_size,
    'Phone Number': r.phone,
  }
})
writeFileSync(path.join(outDir, 'leads-messy.csv'), Papa.unparse(messy), 'utf8')

// ---------- leads-10k.csv (benchmark + dupes trong file) ----------
const tenK: Row[] = [...clean] // 500 dòng đầu trùng file clean → demo idempotency khi import cả hai
for (let i = 0; i < 9300; i++) tenK.push(makeRow(10000 + i))
// ~200 biến thể gmail-dot của chính các dòng trong file → dedupe ngay trong một file
const gmailRows = tenK.filter((r) => r.email.endsWith('@gmail.com')).slice(0, 200)
for (const r of gmailRows) {
  tenK.push({ ...r, full_name: foldDiacritics(r.full_name).toUpperCase(), email: r.email.replace(/\./g, '').replace('@gmailcom', '@gmail.com') })
}
writeFileSync(path.join(outDir, 'leads-10k.csv'), Papa.unparse(tenK.slice(0, 10000)), 'utf8')

console.log(`✓ Đã sinh 3 file CSV mẫu vào ${outDir} (clean=500, messy=300, 10k=${Math.min(tenK.length, 10000)})`)
