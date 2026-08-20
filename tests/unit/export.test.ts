import { describe, expect, it } from 'vitest'
import {
  buildLeadsCsv,
  escapeCsvCell,
  formatCsvRow,
  leadCsvHeaderLine,
  type LeadCsvRow,
} from '@/lib/export/csv'

// AC-6: file export mở bằng Excel KHÔNG thực thi formula.
// SoT: mọi ô bắt đầu bằng = + - @ phải được prefix dấu nháy đơn.

describe('escapeCsvCell — chống CSV injection', () => {
  it('prefix `\'` cho ô bắt đầu bằng =', () => {
    expect(escapeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
  })

  it('prefix `\'` cho ô bắt đầu bằng +', () => {
    expect(escapeCsvCell('+1234567')).toBe("'+1234567")
  })

  it('prefix `\'` cho ô bắt đầu bằng -', () => {
    expect(escapeCsvCell('-5')).toBe("'-5")
  })

  it('prefix `\'` cho ô bắt đầu bằng @', () => {
    expect(escapeCsvCell('@handle')).toBe("'@handle")
  })

  it('formula chứa dấu phẩy/nháy kép: neutralize RỒI quote đúng RFC 4180', () => {
    // =HYPERLINK("x","y") → prefix ' rồi bọc "..." và nhân đôi " bên trong
    expect(escapeCsvCell('=HYPERLINK("https://evil.example","LeadFlow")')).toBe(
      '"\'=HYPERLINK(""https://evil.example"",""LeadFlow"")"',
    )
  })
})

describe('escapeCsvCell — giá trị bình thường không bị đụng', () => {
  it('giữ nguyên tên tiếng Việt có dấu', () => {
    expect(escapeCsvCell('Nguyễn Văn An')).toBe('Nguyễn Văn An')
  })

  it('số trong khoảng an toàn giữ nguyên (không phải formula)', () => {
    expect(escapeCsvCell(200)).toBe('200')
  })

  it('ô chứa dấu phẩy được bọc trong ngoặc kép', () => {
    expect(escapeCsvCell('FPT Software, Ltd.')).toBe('"FPT Software, Ltd."')
  })

  it('ô chứa nháy kép: nhân đôi + bọc', () => {
    expect(escapeCsvCell('Say "hi"')).toBe('"Say ""hi"""')
  })

  it('ô chứa xuống dòng được bọc', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('null/undefined → chuỗi rỗng', () => {
    expect(escapeCsvCell(null)).toBe('')
    expect(escapeCsvCell(undefined)).toBe('')
  })
})

describe('formatCsvRow', () => {
  it('ghép các ô bằng dấu phẩy, escape từng ô', () => {
    expect(formatCsvRow(['a', 'b,c', '=x'])).toBe("a,\"b,c\",'=x")
  })
})

// 4 lead tên bắt đầu bằng = + - @ mà seed đã cài sẵn (src/lib/demo/seed.ts).
const SEEDED_INJECTION_NAMES = [
  '=HYPERLINK("https://evil.example","Nguyen Van A")',
  '+84 Nguyen Injected',
  '-Tran Formula',
  '@Le Command',
]

function makeRow(fullName: string): LeadCsvRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    fullName,
    email: 'inject@test-injection.vn',
    companyName: 'Injection Test Co',
    title: 'QA',
    industry: 'software',
    companySize: 10,
    phone: null,
    phoneValid: null,
    status: 'new',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ruleScore: null,
    aiScore: null,
    aiReason: null,
  }
}

describe('buildLeadsCsv — 4 lead injection từ seed', () => {
  it('mỗi ô tên nguy hiểm đều bị vô hiệu hoá (bắt đầu bằng `\'`, kể cả khi được quote)', () => {
    for (const name of SEEDED_INJECTION_NAMES) {
      const cell = escapeCsvCell(name)
      // Bỏ dấu " mở đầu nếu ô bị quote, phần còn lại phải bắt đầu bằng '
      const inner = cell.startsWith('"') ? cell.slice(1) : cell
      expect(inner.startsWith("'")).toBe(true)
      // Không bao giờ để ô bắt đầu trực tiếp bằng ký tự formula
      expect(/^[=+\-@]/.test(cell)).toBe(false)
    }
  })

  it('CSV hoàn chỉnh: 1 dòng header + N dòng data, không có ô data mở đầu bằng formula', () => {
    const rows = SEEDED_INJECTION_NAMES.map(makeRow)
    const csv = buildLeadsCsv(rows)
    const lines = csv.trimEnd().split('\r\n')

    expect(lines[0]).toBe(leadCsvHeaderLine())
    expect(lines).toHaveLength(1 + rows.length)

    // Từng ô của từng dòng data: không ô nào bắt đầu bằng = + - @
    for (const line of lines.slice(1)) {
      // parse thô theo dấu phẩy đủ cho assertion này (giá trị nguy hiểm đã được quote)
      for (const field of line.split(',')) {
        expect(/^[=+\-@]/.test(field)).toBe(false)
      }
    }
  })

  it('giữ nguyên unicode tiếng Việt trong dữ liệu bình thường', () => {
    const csv = buildLeadsCsv([{ ...makeRow('Nguyễn Văn An'), companyName: 'Vinamilk' }])
    expect(csv).toContain('Nguyễn Văn An')
    expect(csv).toContain('Vinamilk')
  })
})
