import React from 'react'
import Link from 'next/link'
import { AnySkinLogo } from '@/components/anyskin-logo'

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center">
              <AnySkinLogo className="h-5 sm:h-6 w-auto" />
            </Link>
            <nav className="flex items-center gap-4 sm:gap-6 text-sm">
              <Link
                href="/products"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Products
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="container mx-auto py-6 sm:py-8 px-4 sm:px-6">{children}</main>
      <footer className="border-t py-6">
        <div className="container mx-auto px-4 sm:px-6 flex items-center justify-between text-xs sm:text-sm text-muted-foreground">
          <p>AnySkin &mdash; Haut. Rein.</p>
          <a
            href="https://www.anyskin.app"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            anyskin.app
          </a>
        </div>
      </footer>
    </>
  )
}
