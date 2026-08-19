import type { ReactNode } from 'react'
import { NavLink } from '@/components/nav-link'
import { Providers } from '@/components/providers'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
        <aside className="fixed inset-y-0 left-0 flex w-56 flex-col border-r border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-6 px-3">
            <span className="text-lg font-semibold text-white">LeadFlow</span>
            <p className="text-[11px] text-zinc-500">import → dedupe → score</p>
          </div>
          <nav className="flex flex-col gap-1">
            <NavLink href="/leads">Leads</NavLink>
            <NavLink href="/imports">Imports</NavLink>
            <NavLink href="/dedupe">Dedupe</NavLink>
            <NavLink href="/settings">Scoring settings</NavLink>
          </nav>
          <div className="mt-auto px-3 text-[11px] text-zinc-600">Demo data — Faker, dupes planted on purpose</div>
        </aside>
        <main className="ml-56 flex-1 p-8">{children}</main>
      </div>
    </Providers>
  )
}
