import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { computePairHash } from '@/lib/dedupe/constants'

// pair_hash = sha256(min(idA,idB) || ':' || max(idA,idB)) — SoT 20-dedupe-spec.md.
// Bản JS này phải khớp bản SQL encode(sha256(convert_to(a.id||':'||b.id,'UTF8')),'hex') với a.id < b.id.

const ID1 = '00000000-0000-0000-0000-000000000001'
const ID2 = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

describe('computePairHash', () => {
  it('độc lập thứ tự đối số (idempotent theo cặp)', () => {
    expect(computePairHash(ID1, ID2)).toBe(computePairHash(ID2, ID1))
  })

  it('khớp sha256 của "min:max" (canonical lowercase uuid, min theo so sánh text)', () => {
    const expected = createHash('sha256').update(`${ID1}:${ID2}`).digest('hex')
    expect(computePairHash(ID2, ID1)).toBe(expected)
  })

  it('cặp khác nhau → hash khác nhau', () => {
    const ID3 = '00000000-0000-0000-0000-000000000002'
    expect(computePairHash(ID1, ID2)).not.toBe(computePairHash(ID1, ID3))
  })

  it('trả về hex sha256 dài 64 ký tự', () => {
    expect(computePairHash(ID1, ID2)).toMatch(/^[0-9a-f]{64}$/)
  })
})
