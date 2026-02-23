import React from 'react'
import Link from 'next/link'
import { AnySkinLogo } from '@/components/anyskin-logo'
import { BottomNav } from '@/components/bottom-nav'

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Top bar — solid bg, no transparency, respects iOS status bar */}
      <header className="sticky top-0 z-40 w-full border-b bg-background pt-[env(safe-area-inset-top,0px)]">
        <div className="flex h-11 items-center px-4">
          <Link href="/discover" className="flex items-center">
            <AnySkinLogo className="h-5 w-auto" />
          </Link>
        </div>
      </header>

      {/* Page content — bottom padding = nav (~80px) + safe area + breathing room */}
      <main className="flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
        {children}
      </main>

      <BottomNav />
    </div>
  )
}
