'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname()
  const active = pathname === href || pathname.startsWith(`${href}/`)
  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-2 text-sm transition ${
        active ? 'bg-zinc-800 font-medium text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
      }`}
    >
      {children}
    </Link>
  )
}
