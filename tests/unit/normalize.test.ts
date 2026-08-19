import { describe, expect, it } from 'vitest'
import { isValidEmail, normalizeEmail } from '@/lib/normalize/email'
import { validatePhone } from '@/lib/normalize/phone'
import { foldDiacritics, normalizeCompany, normalizePersonName, sortNameTokens } from '@/lib/normalize/text'

describe('normalizeEmail', () => {
  it('lowercase + trim cho mọi domain', () => {
    expect(normalizeEmail('  Minh.Tran@FPT.com.vn ')).toBe('minh.tran@fpt.com.vn')
  })

  it('gmail: bỏ dấu chấm trong local part', () => {
    expect(normalizeEmail('nguyen.van.an@gmail.com')).toBe('nguyenvanan@gmail.com')
  })

  it('gmail: strip +suffix', () => {
    expect(normalizeEmail('lan.pham+crm@gmail.com')).toBe('lanpham@gmail.com')
  })

  it('googlemail.com là alias của gmail.com', () => {
    expect(normalizeEmail('a.b@googlemail.com')).toBe('ab@gmail.com')
  })

  it('KHÔNG bỏ dấu chấm với domain khác gmail (brief §5 — chi tiết dễ sai)', () => {
    expect(normalizeEmail('nguyen.van.an@fptsoft.vn')).toBe('nguyen.van.an@fptsoft.vn')
    expect(normalizeEmail('nguyenvanan@fptsoft.vn')).toBe('nguyenvanan@fptsoft.vn')
  })

  it('KHÔNG strip +suffix với domain khác gmail', () => {
    expect(normalizeEmail('a+tag@company.com')).toBe('a+tag@company.com')
  })

  it('email không hợp lệ → null', () => {
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('a@b')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail('a b@c.com')).toBeNull()
  })

  it('gmail local part chỉ toàn dấu chấm/+ → null', () => {
    expect(normalizeEmail('+abc@gmail.com')).toBeNull()
  })

  it('isValidEmail đồng bộ với normalizeEmail', () => {
    expect(isValidEmail('x@y.com')).toBe(true)
    expect(isValidEmail('bad')).toBe(false)
  })
})

describe('foldDiacritics', () => {
  it('bỏ dấu tiếng Việt, gồm đ/Đ', () => {
    expect(foldDiacritics('Nguyễn Văn Ẩn')).toBe('Nguyen Van An')
    expect(foldDiacritics('Đặng Thị Bích Đào')).toBe('Dang Thi Bich Dao')
  })
})

describe('normalizePersonName', () => {
  it('fold dấu + lowercase + gọn khoảng trắng + bỏ punctuation', () => {
    expect(normalizePersonName('  Nguyễn   Văn Ẩn ')).toBe('nguyen van an')
    expect(normalizePersonName('Pham Q. Huy')).toBe('pham q huy')
  })
  it('rỗng → null', () => {
    expect(normalizePersonName('')).toBeNull()
    expect(normalizePersonName('   ')).toBeNull()
  })
})

describe('normalizeCompany', () => {
  it('bỏ hậu tố pháp lý EN (lặp nhiều tầng)', () => {
    expect(normalizeCompany('FPT Software Ltd.')).toBe('fpt software')
    expect(normalizeCompany('VNG Corporation')).toBe('vng')
    expect(normalizeCompany('TIKI JSC')).toBe('tiki')
    expect(normalizeCompany('Acme Holdings Inc')).toBe('acme')
  })

  it('bỏ tiền tố pháp lý VN', () => {
    expect(normalizeCompany('Công ty Cổ phần FPT')).toBe('fpt')
    expect(normalizeCompany('Công ty TNHH MTV Thương Mại Sao Việt')).toBe('thuong mai sao viet')
  })

  it('không strip từ giữa tên', () => {
    expect(normalizeCompany('Grab Financial Group')).toBe('grab financial')
    expect(normalizeCompany('Sun Life Vietnam')).toBe('sun life vietnam')
  })

  it('tên chỉ còn hậu tố sau khi strip → giữ bản base thay vì trả rỗng', () => {
    expect(normalizeCompany('Company')).toBe('company')
  })

  it('rỗng → null', () => {
    expect(normalizeCompany('')).toBeNull()
    expect(normalizeCompany(null)).toBeNull()
  })
})

describe('sortNameTokens', () => {
  it('bắt được đảo thứ tự tên', () => {
    expect(sortNameTokens('vu thi mai')).toBe('mai thi vu')
    expect(sortNameTokens('mai vu')).toBe('mai vu')
  })
})

describe('validatePhone', () => {
  it('số VN hợp lệ (nội địa + quốc tế)', () => {
    expect(validatePhone('0912345678')).toBe(true)
    expect(validatePhone('+84912345678')).toBe(true)
    expect(validatePhone('0912 345 678')).toBe(true)
  })
  it('số không hợp lệ', () => {
    expect(validatePhone('12345')).toBe(false)
    expect(validatePhone('abc')).toBe(false)
  })
  it('rỗng → null (không có ≠ sai)', () => {
    expect(validatePhone('')).toBeNull()
    expect(validatePhone(null)).toBeNull()
    expect(validatePhone('   ')).toBeNull()
  })
})
