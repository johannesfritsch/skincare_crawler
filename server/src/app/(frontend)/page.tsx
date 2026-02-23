import { getPayload } from 'payload'
import config from '@payload-config'
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default async function HomePage() {
  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  const [productCount] = await db.select({ count: sql<number>`count(*)` }).from(t.products)
  const [brandCount] = await db.select({ count: sql<number>`count(*)` }).from(t.brands)
  const [ingredientCount] = await db.select({ count: sql<number>`count(*)` }).from(t.ingredients)

  return (
    <div>
      <div className="mb-8 sm:mb-10">
        <h1 className="text-2xl sm:text-4xl font-bold tracking-tight mb-2">Product Database</h1>
        <p className="text-sm sm:text-lg text-muted-foreground">
          Beauty &amp; skincare product data aggregated from German retailers.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
        <Card>
          <CardHeader className="p-4 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Products</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl sm:text-3xl font-bold">{productCount?.count ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Brands</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl sm:text-3xl font-bold">{brandCount?.count ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Ingredients</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="text-2xl sm:text-3xl font-bold">{ingredientCount?.count ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Button asChild className="w-full sm:w-auto">
        <Link href="/products">Browse Products</Link>
      </Button>
    </div>
  )
}
