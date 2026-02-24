'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Menu, FileText, Shield, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { AnySkinLogo } from '@/components/anyskin-logo'

const legalLinks = [
  { label: 'Imprint', href: '/imprint', icon: FileText },
  { label: 'Terms of Service', href: '/terms', icon: Scale },
  { label: 'Data Protection', href: '/privacy', icon: Shield },
] as const

export function AppDrawer() {
  const pathname = usePathname()

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Menu">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0 flex flex-col">
        <SheetHeader className="px-5 pt-6 pb-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <AnySkinLogo className="h-6 w-auto" />
        </SheetHeader>

        <Separator />

        <div className="flex-1 px-3 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-2">
            Legal
          </p>
          <nav className="flex flex-col gap-0.5">
            {legalLinks.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors ${
                  pathname === href
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground active:bg-muted'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <Separator />

        <div className="px-5 py-4">
          <p className="text-xs text-muted-foreground">
            AnySkin &mdash; Haut. Rein.
          </p>
          <a
            href="https://www.anyskin.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            anyskin.app
          </a>
        </div>
      </SheetContent>
    </Sheet>
  )
}
