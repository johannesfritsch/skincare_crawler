'use client'

import { usePathname } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { PackageSearch, ArrowLeft, Send, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function ProductNotFound() {
  const pathname = usePathname()
  const gtin = pathname.split('/').pop() || ''

  const [submitted, setSubmitted] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // TODO: wire up to an API endpoint / email service
    setSubmitted(true)
  }

  return (
    <div className="flex flex-col items-center px-4 py-12 sm:py-20">
      {/* Hero section */}
      <div className="flex flex-col items-center text-center max-w-lg mb-10">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-6">
          <PackageSearch className="h-10 w-10 text-muted-foreground" />
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
          Product not found
        </h1>

        {gtin && (
          <p className="text-muted-foreground mb-4">
            We couldn&apos;t find a product with GTIN{' '}
            <code className="bg-muted px-2 py-0.5 rounded text-sm font-mono">
              {gtin}
            </code>
          </p>
        )}

        <Separator className="my-2 w-16 mx-auto" />

        <p className="text-sm text-muted-foreground leading-relaxed mt-4">
          AnySkin currently aggregates{' '}
          <span className="font-medium text-foreground">cosmetics and skincare products</span>{' '}
          from German retailers. If this barcode belongs to a food, household, or other
          non-cosmetics product, it won&apos;t appear in our database.
        </p>

        <div className="flex flex-wrap justify-center gap-2 mt-5">
          {['Skincare', 'Haircare', 'Body care', 'Makeup', 'Sun protection'].map((cat) => (
            <Badge key={cat} variant="secondary" className="text-xs">
              {cat}
            </Badge>
          ))}
        </div>
      </div>

      {/* Feedback form */}
      <Card className="w-full max-w-md">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Think this is an error?</CardTitle>
          <CardDescription>
            If this is a cosmetics product that should be in our database, let us know and
            we&apos;ll look into it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="flex flex-col items-center py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-primary mb-3" />
              <p className="font-medium mb-1">Thanks for the feedback!</p>
              <p className="text-sm text-muted-foreground">
                We&apos;ll review this product and add it if it qualifies.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="gtin-field">GTIN / Barcode</Label>
                <Input
                  id="gtin-field"
                  value={gtin}
                  readOnly
                  className="font-mono bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email-field">
                  Email <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="email-field"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message-field">
                  Product details <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="message-field"
                  placeholder="Product name, brand, where you found it..."
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              <Button type="submit" className="w-full mt-1">
                <Send className="h-4 w-4 mr-2" />
                Submit feedback
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Back link */}
      <div className="mt-8">
        <Button variant="ghost" asChild>
          <Link href="/products">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Browse all products
          </Link>
        </Button>
      </div>
    </div>
  )
}
