import { describe, expect, it } from 'vitest'
import { guessMapping } from '@/lib/import/guess-mapping'

describe('guessMapping', () => {
  it('map header snake_case sạch (leads-clean/10k)', () => {
    expect(guessMapping(['full_name', 'email', 'company', 'title', 'industry', 'company_size', 'phone'])).toEqual({
      full_name: 'fullName',
      email: 'email',
      company: 'companyName',
      title: 'title',
      industry: 'industry',
      company_size: 'companySize',
      phone: 'phone',
    })
  })

  it('map header lạ + tiếng Việt (leads-messy)', () => {
    expect(
      guessMapping(['Họ và tên', 'E-mail Address', 'Company Name', 'Job Title', 'Nganh', 'Size', 'Phone Number']),
    ).toEqual({
      'Họ và tên': 'fullName',
      'E-mail Address': 'email',
      'Company Name': 'companyName',
      'Job Title': 'title',
      Nganh: 'industry',
      Size: 'companySize',
      'Phone Number': 'phone',
    })
  })

  it('company_size trúng size chứ không phải company (độ đặc hiệu)', () => {
    const m = guessMapping(['company', 'company_size'])
    expect(m.company).toBe('companyName')
    expect(m.company_size).toBe('companySize')
  })

  it('mỗi field chỉ nhận từ một header — header sau bị bỏ (null)', () => {
    const m = guessMapping(['email', 'email_2'])
    expect(m.email).toBe('email')
    expect(m.email_2).toBeNull()
  })

  it('header không khớp gì → null', () => {
    expect(guessMapping(['random_col', 'notes'])).toEqual({ random_col: null, notes: null })
  })
})
