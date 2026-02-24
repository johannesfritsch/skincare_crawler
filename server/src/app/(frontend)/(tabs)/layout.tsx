import React from 'react'
import { AppHeader } from '@/components/app-header'
import { BottomNav } from '@/components/bottom-nav'
import { MainContent } from '@/components/main-content'

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-[100dvh] bg-background">
      <AppHeader />

      {/* Page content — padding adjusts based on whether bottom nav is visible */}
      <MainContent>{children}</MainContent>

      <BottomNav />
    </div>
  )
}
