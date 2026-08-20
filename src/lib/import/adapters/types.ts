import type { ColumnMapping } from '../fields'

// Interface adapter nguồn dữ liệu. Mục tiêu: MỌI nguồn (CSV, Apollo, LinkedIn, …) chỉ cần
// biến dữ liệu của nó thành `AdapterRawRow` + khai báo `mapping` header→LeadField, rồi đi qua
// ĐÚNG pipeline staging import_rows hiện có (xem ingest.ts). Không nguồn nào tự ghi vào `leads`.

/** Một dòng thô sau khi adapter đã "flatten" record của nguồn về không gian cột phẳng. */
export type AdapterRawRow = Record<string, string>

export interface SourceAdapter {
  /** Ghi vào import_batches.source_type + lead_sources.source_type (vd 'apollo_mock'). */
  readonly sourceType: string
  /** Nhãn hiển thị của batch (import_batches.filename). */
  readonly label: string
  /** mapping { header → LeadField | null } cho các AdapterRawRow adapter sinh ra. */
  readonly mapping: ColumnMapping
  /**
   * Lấy dữ liệu từ nguồn rồi CHUYỂN ĐỔI về AdapterRawRow.
   * Mock: sinh dữ liệu giả (không gọi mạng). Apollo thật: chỉ khác ở thân hàm này (gọi API,
   * phân trang) — phần còn lại của pipeline không đổi.
   */
  fetchRows(options?: { limit?: number }): Promise<AdapterRawRow[]>
}
