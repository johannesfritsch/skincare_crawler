import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, ilike, or, sql } from 'drizzle-orm'
import React, { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ProductSearch } from '@/components/product-search'

export const metadata = {
  title: 'Products — AnySkin',
}

interface Props {
  searchParams: Promise<{ q?: string }>
}

export default async function ProductsPage({ searchParams }: Props) {
  const { q } = await searchParams
  const searchTerm = q?.trim() || ''

  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const { products, brands, product_types } = payload.db.tables

  const { media } = payload.db.tables

  // Build base query
  let query = db
    .select({
      id: products.id,
      name: products.name,
      gtin: products.gtin,
      description: products.description,
      brandName: brands.name,
      productTypeName: product_types.name,
      createdAt: products.createdAt,
      imageUrl: sql<string | null>`coalesce(${media}.sizes_thumbnail_url, ${media}.url)`,
    })
    .from(products)
    .leftJoin(brands, eq(products.brand, brands.id))
    .leftJoin(product_types, eq(products.productType, product_types.id))
    .leftJoin(media, eq(products.image, media.id))
    .orderBy(desc(products.createdAt))
    .limit(50)
    .$dynamic()

  // Build count query
  let countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .leftJoin(brands, eq(products.brand, brands.id))
    .$dynamic()

  if (searchTerm) {
    const pattern = `%${searchTerm}%`
    const whereClause = or(
      ilike(products.name, pattern),
      ilike(products.gtin, pattern),
      ilike(brands.name, pattern),
    )
    query = query.where(whereClause)
    countQuery = countQuery.where(whereClause)
  }

  const [rows, countResult] = await Promise.all([query, countQuery])
  const totalCount = countResult[0]?.count ?? 0

  return (
    <div>
      <div className="mb-5">
        <Suspense>
          <ProductSearch />
        </Suspense>
      </div>

      {searchTerm && rows.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-muted-foreground">
            No products found for &ldquo;{searchTerm}&rdquo;
          </p>
          <Link href="/products" className="text-sm text-primary hover:underline mt-2 inline-block">
            Clear search
          </Link>
        </div>
      )}

      {/* Mobile: card list */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <Link key={row.id} href={`/products/${row.gtin}`}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden p-1">
                    {row.imageUrl ? (
                      <Image
                        src={row.imageUrl}
                        alt={row.name ?? 'Product'}
                        width={96}
                        height={96}
                        className="h-full w-full object-contain"
                        sizes="40px"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-muted-foreground/30">
                        {(row.name ?? '?')[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {row.name || <span className="text-muted-foreground">Unnamed</span>}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {row.brandName || 'No brand'}
                      {row.gtin && (
                        <span> &middot; <code className="text-xs bg-muted px-1 py-0.5 rounded">{row.gtin}</code></span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {row.productTypeName && (
                      <Badge variant="secondary" className="text-xs">{row.productTypeName}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {row.createdAt ? new Date(row.createdAt).toLocaleDateString('de-DE') : ''}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Desktop: table */}
      {rows.length > 0 && (
        <div className="hidden md:block rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>GTIN</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <Link href={`/products/${row.gtin}`} className="hover:underline">
                      {row.name || <span className="text-muted-foreground">Unnamed</span>}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.gtin ? (
                      <code className="text-sm bg-muted px-1.5 py-0.5 rounded">{row.gtin}</code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{row.brandName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {row.productTypeName ? (
                      <Badge variant="secondary">{row.productTypeName}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    {row.createdAt ? new Date(row.createdAt).toLocaleDateString('de-DE') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Desktop empty state (when not searching — search empty state handled above) */}
      {!searchTerm && rows.length === 0 && (
        <div className="hidden md:block">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>GTIN</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No products found
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
