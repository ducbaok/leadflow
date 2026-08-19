import { LeadDetail } from '@/components/leads/lead-detail'

export const metadata = { title: 'Lead — LeadFlow' }

// Trang chi tiết lead: thông tin + đổi status + danh sách nguồn (provenance) + scores.
// Contract API: GET/PATCH /api/leads/:id (docs/sot/40-api-contracts.md §Leads)
export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <LeadDetail id={id} />
}
