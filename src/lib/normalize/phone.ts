import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js'

// Brief §5: chỉ validate valid/invalid, KHÔNG normalize sâu ở MVP.

/**
 * null = không có số điện thoại; true/false = có và (không) hợp lệ.
 * defaultCountry áp dụng khi số không có mã quốc gia (+84...).
 */
export function validatePhone(raw: string | null | undefined, defaultCountry: CountryCode = 'VN'): boolean | null {
  if (!raw || !raw.trim()) return null
  try {
    return isValidPhoneNumber(raw.trim(), defaultCountry)
  } catch {
    return false
  }
}
