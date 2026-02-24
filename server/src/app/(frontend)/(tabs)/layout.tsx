import React from 'react'
import Link from 'next/link'
import { User } from 'lucide-react'
import { AnySkinLogo } from '@/components/anyskin-logo'
import { AppDrawer } from '@/components/app-drawer'
import { BottomNav } from '@/components/bottom-nav'
import { Button } from '@/components/ui/button'

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Top bar — burger | centered logo | profile */}
      <header className="sticky top-0 z-40 w-full border-b bg-background pt-[env(safe-area-inset-top,0px)]">
        <div className="flex h-12 items-center justify-between px-2">
          <AppDrawer />
          <Link href="/discover" className="absolute left-1/2 -translate-x-1/2">
            <AnySkinLogo className="h-5 w-auto" />
          </Link>
          <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
            <Link href="/profile" aria-label="Profile">
              <User className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] standalone-bottom-pad">
        {children}
      </main>

      <BottomNav />
    </div>
  )
}
