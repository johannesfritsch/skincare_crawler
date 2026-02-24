'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, User } from 'lucide-react'
import { AnySkinLogo } from '@/components/anyskin-logo'
import { AppDrawer } from '@/components/app-drawer'
import { Button } from '@/components/ui/button'

const tabRoots = ['/discover', '/videos', '/products', '/lists', '/profile']

export function AppHeader() {
  const pathname = usePathname()
  const router = useRouter()

  const isTabRoot = tabRoots.includes(pathname)

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background pt-[env(safe-area-inset-top,0px)]">
      <div className="flex h-12 items-center justify-between px-2">
        {isTabRoot ? (
          <AppDrawer />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => router.back()}
            aria-label="Go back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
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
  )
}
