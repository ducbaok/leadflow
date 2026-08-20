import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Seam cho AC-10 phần "scan THẬT của luồng D".
// Luồng D (Batch 2) viết fuzzy dedupe trên branch riêng — CHƯA merge vào stream/f-tests.
// Khi chưa merge: dedupeScanImplemented()=false → describe gated trong golden-fuzzy.test.ts tự skip
// (không đỏ CI). Khi D merge (thêm src/lib/dedupe/ + src/app/api/dedupe/scan/route.ts):
//   1. Gate lật true, block "Stream D scan" chạy.
//   2. Người tích hợp nối runDedupeScan() với scan thật của D (đúng 1 chỗ, xem TODO bên dưới).
// Không import module của D ở đây để `npm run typecheck` không vỡ khi module chưa tồn tại.

export function dedupeScanImplemented(): boolean {
  const root = process.cwd()
  return (
    existsSync(resolve(root, 'src/lib/dedupe')) &&
    existsSync(resolve(root, 'src/app/api/dedupe/scan/route.ts'))
  )
}

/**
 * Chạy fuzzy scan THẬT của luồng D để đổ candidate vào `dedupe_pairs`.
 * TODO(khi luồng D merge): thay thân hàm bằng lời gọi scan thật, ví dụ:
 *   const mod = await import(['@/lib/dedupe', 'scan'].join('/')) // specifier động → tsc không resolve sớm
 *   await mod.scanForDuplicates(db)
 * (specifier viết động để typecheck không vỡ trước khi D merge.)
 */
export async function runDedupeScan(db: unknown): Promise<void> {
  void db // sẽ truyền cho scan thật của D khi nối (xem TODO trên)
  throw new Error('runDedupeScan chưa nối với luồng D — xem tests/integration/helpers/dedupe-adapter.ts')
}
