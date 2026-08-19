import { Readable } from 'node:stream'
import Papa from 'papaparse'
import type { Db } from '@/db/client'
import { importRows } from '@/db/schema'

// Parse CSV theo STREAM + đổ thô vào staging import_rows theo lô (bulk insert).
// Không normalize ở đây — mapping chưa biết lúc upload. Job import.process mới normalize/promote.
// Kiến trúc: brief §3.1 — bulk → staging, không row-by-row qua ORM.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // 20MB (SoT 00-scope §non-functional)
const STAGE_CHUNK = 1000 // số dòng mỗi lần insert vào import_rows
const PREVIEW_ROWS = 20 // SoT contract: preview 20 dòng đầu

export type ParseResult = {
  headers: string[]
  preview: string[][]
  totalRows: number
}

/**
 * Đọc `file` theo stream, insert thô vào import_rows (raw jsonb + row_number).
 * Bộ nhớ bị chặn: buffer tối đa STAGE_CHUNK dòng + PREVIEW_ROWS dòng preview
 * (không giữ toàn bộ file trong RAM dù cap 20MB đã an toàn).
 */
export async function parseAndStage(file: File, db: Db, batchId: string): Promise<ParseResult> {
  const nodeStream = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0])

  let headers: string[] = []
  const preview: string[][] = []
  let rowNumber = 0
  let buffer: { batchId: string; rowNumber: number; raw: Record<string, unknown> }[] = []

  const flush = async () => {
    if (buffer.length === 0) return
    const rows = buffer
    buffer = []
    await db.insert(importRows).values(rows)
  }

  await new Promise<void>((resolve, reject) => {
    Papa.parse<Record<string, string>>(nodeStream, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      chunk: (results, parser) => {
        // Tạm dừng nguồn để chờ insert xong (backpressure), rồi resume.
        parser.pause()
        void (async () => {
          try {
            if (headers.length === 0 && results.meta.fields) {
              headers = results.meta.fields.filter((h) => h.length > 0)
            }
            for (const row of results.data) {
              rowNumber += 1
              if (preview.length < PREVIEW_ROWS) {
                preview.push(headers.map((h) => (row[h] == null ? '' : String(row[h]))))
              }
              buffer.push({ batchId, rowNumber, raw: row })
              if (buffer.length >= STAGE_CHUNK) await flush()
            }
            parser.resume()
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })()
      },
      complete: () => {
        void flush()
          .then(() => resolve())
          .catch((err) => reject(err instanceof Error ? err : new Error(String(err))))
      },
      error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    })
  })

  return { headers, preview, totalRows: rowNumber }
}
