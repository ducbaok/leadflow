import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { scanForDuplicates } from '@/lib/dedupe/scan'
import type { Db } from './db'

// Seam cho AC-10 phần "scan THẬT của luồng D" — ĐÃ NỐI khi merge Batch 2.
// Gate giữ lại để suite tự skip nếu module dedupe bị gỡ (an toàn hơn là đỏ khó hiểu).

export function dedupeScanImplemented(): boolean {
  const root = process.cwd()
  return (
    existsSync(resolve(root, 'src/lib/dedupe')) &&
    existsSync(resolve(root, 'src/app/api/dedupe/scan/route.ts'))
  )
}

/**
 * Chạy fuzzy scan THẬT của luồng D (quét toàn cục) trên executor của test — truyền transaction
 * của withRollback vào để scan thấy leads chưa commit và mọi dedupe_pairs sinh ra bị rollback sạch.
 * (scanForDuplicates mở transaction lồng → savepoint trong tx của test.)
 */
export async function runDedupeScan(db: Db): Promise<void> {
  await scanForDuplicates(undefined, db)
}
