'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Search, Camera } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AnySkinLogo } from '@/components/anyskin-logo'

export default function HomePage() {
  const router = useRouter()
  const [query, setQuery] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return

    // If it looks like a GTIN (all digits, 8 or 13 chars), go directly to product
    if (/^\d{8}$|^\d{13}$/.test(trimmed)) {
      router.push(`/products/${trimmed}`)
    } else {
      router.push(`/products?q=${encodeURIComponent(trimmed)}`)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-lg">
        <AnySkinLogo className="h-8 sm:h-10 w-auto mx-auto mb-8" />

        <p className="text-sm text-muted-foreground text-center mb-6">
          Search by name, brand, or scan a barcode
        </p>

        <form onSubmit={handleSubmit} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Product name, brand, or GTIN..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-12 h-12 text-base"
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 text-muted-foreground hover:text-foreground"
            aria-label="Scan barcode"
          >
            <Camera className="h-5 w-5" />
          </Button>
        </form>
      </div>
    </div>
  )
}
