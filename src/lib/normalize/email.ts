// Quy tắc normalize email — SoT: docs/sot/10-data-model.md §email
// QUAN TRỌNG (brief §5): bỏ dấu chấm + strip "+suffix" CHỈ áp dụng cho
// gmail.com/googlemail.com. Áp cho domain khác sẽ merge nhầm lead của công ty khác.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/** Trả về email đã normalize, hoặc null nếu rỗng/không hợp lệ. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed || !EMAIL_RE.test(trimmed)) return null

  const at = trimmed.lastIndexOf('@')
  let local = trimmed.slice(0, at)
  let domain = trimmed.slice(at + 1)

  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com' // googlemail.com là alias cùng hộp thư
    local = local.replace(/\./g, '')
    const plus = local.indexOf('+')
    if (plus !== -1) local = local.slice(0, plus)
    if (!local) return null
  }

  return `${local}@${domain}`
}

export function isValidEmail(raw: string | null | undefined): boolean {
  return normalizeEmail(raw) !== null
}
