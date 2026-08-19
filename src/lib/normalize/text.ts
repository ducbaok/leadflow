// Normalize tên người & tên công ty — SoT: docs/sot/10-data-model.md §text
// Mục tiêu: đưa về dạng canonical để (1) so exact, (2) làm đầu vào pg_trgm similarity.

/** Bỏ dấu tiếng Việt và diacritics nói chung ("Nguyễn Văn Ẩn" → "Nguyen Van An"). */
export function foldDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd') // đ
    .replace(/Đ/g, 'D') // Đ
}

function baseNormalize(s: string): string {
  return foldDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Hậu tố pháp lý (EN) — bỏ ở CUỐI tên công ty, lặp cho tới khi hết
const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'jsc', 'plc', 'gmbh', 'sa', 'ag', 'group', 'holdings',
])

// Tiền tố pháp lý (VN, sau khi fold dấu) — bỏ ở ĐẦU tên công ty
const VN_LEGAL_PREFIX = /^(cong ty|cty)( (co phan|cp|tnhh|trach nhiem huu han|mtv|lien doanh))*\s*/

/** "Công ty Cổ phần FPT Software Ltd." → "fpt software" */
export function normalizeCompany(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = baseNormalize(raw)
  if (!s) return null

  s = s.replace(VN_LEGAL_PREFIX, '').trim()

  const tokens = s.split(' ')
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop()
  }
  const result = tokens.join(' ').trim()
  // Nếu strip hết sạch (tên công ty chỉ toàn hậu tố?) thì giữ bản base
  return result || s || null
}

/** "Nguyễn Văn Ẩn" → "nguyen van an" */
export function normalizePersonName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = baseNormalize(raw)
  return s || null
}

/**
 * Sắp xếp token theo alphabet — dùng cho fuzzy match tên người để bắt
 * trường hợp đảo thứ tự ("Vu Thi Mai" vs "Mai Vu"). SoT: docs/sot/20-dedupe-spec.md
 */
export function sortNameTokens(normalizedName: string): string {
  return normalizedName.split(' ').sort().join(' ')
}
