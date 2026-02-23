import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, sql } from 'drizzle-orm'
import React from 'react'
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

export const metadata = {
  title: 'Products — AnySkin',
}

export default async function ProductsPage() {
  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const { products, brands, product_types } = payload.db.tables

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      gtin: products.gtin,
      description: products.description,
      brandName: brands.name,
      productTypeName: product_types.name,
      createdAt: products.createdAt,
    })
    .from(products)
    .leftJoin(brands, eq(products.brand, brands.id))
    .leftJoin(product_types, eq(products.productType, product_types.id))
    .orderBy(desc(products.createdAt))
    .limit(50)

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
  const totalCount = countResult[0]?.count ?? 0

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Products</h1>
        <p className="text-sm text-muted-foreground">
          Showing {rows.length} of {totalCount}
        </p>
      </div>

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
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <Link href={`/products/${row.id}`} className="hover:underline">
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
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No products found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
