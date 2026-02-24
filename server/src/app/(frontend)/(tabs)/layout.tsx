import React from 'react'
import { AppHeader } from '@/components/app-header'
import { BottomNav } from '@/components/bottom-nav'

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-[100dvh] bg-background">
      <AppHeader />

      {/* Page content */}
      <main className="flex-1 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] standalone-bottom-pad">
        {children}
      </main>

      <BottomNav />
    </div>
  )
}
