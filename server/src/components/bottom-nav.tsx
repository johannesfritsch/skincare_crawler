'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { Sparkles, Play, ScanLine, Search, User } from 'lucide-react'
import { BarcodeScanner } from '@/components/barcode-scanner'

const tabs = [
  { key: 'discover', label: 'Discover', icon: Sparkles, href: '/discover' },
  { key: 'videos', label: 'Videos', icon: Play, href: '/videos' },
  { key: 'scan', label: 'Scan', icon: ScanLine, href: null },
  { key: 'search', label: 'Search', icon: Search, href: '/products' },
  { key: 'profile', label: 'Profile', icon: User, href: '/profile' },
] as const

function getActiveTab(pathname: string): string {
  if (pathname.startsWith('/products')) return 'search'
  if (pathname.startsWith('/discover')) return 'discover'
  if (pathname.startsWith('/videos')) return 'videos'
  if (pathname.startsWith('/profile')) return 'profile'
  return 'discover'
}

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [scannerOpen, setScannerOpen] = useState(false)
  const activeTab = getActiveTab(pathname)

  const handleBarcodeDetected = useCallback(
    (gtin: string) => {
      setScannerOpen(false)
      router.push(`/products/${gtin}`)
    },
    [router],
  )

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background">
        <div className="flex items-end justify-around px-1">
          {tabs.map((tab) => {
            const isCenter = tab.key === 'scan'
            const isActive = tab.key === activeTab
            const Icon = tab.icon

            if (isCenter) {
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="flex flex-col items-center -mt-5 group"
                  aria-label="Scan barcode"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-95">
                    <Icon className="h-7 w-7" strokeWidth={2.5} />
                  </span>
                  <span className="text-[11px] font-medium mt-1 text-muted-foreground">
                    {tab.label}
                  </span>
                </button>
              )
            }

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => tab.href && router.push(tab.href)}
                className="flex flex-col items-center justify-center min-w-[3.5rem] pt-3 pb-1 group"
                aria-label={tab.label}
              >
                <Icon
                  className={`h-6 w-6 transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground group-active:text-foreground'
                  }`}
                  strokeWidth={isActive ? 2.25 : 1.75}
                />
                <span
                  className={`text-[11px] mt-1 transition-colors ${
                    isActive ? 'font-semibold text-primary' : 'font-medium text-muted-foreground'
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            )
          })}
        </div>
        {/* Safe area spacer — fills the home indicator / gesture bar area */}
        <div className="h-[env(safe-area-inset-bottom,0px)] bg-background" />
      </nav>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleBarcodeDetected}
      />
    </>
  )
}
