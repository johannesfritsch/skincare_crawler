import { getPayload } from 'payload'
import config from '@payload-config'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const productId = Number(id)
  if (Number.isNaN(productId)) notFound()

  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  const [product] = await db
    .select({
      id: t.products.id,
      name: t.products.name,
      gtin: t.products.gtin,
      description: t.products.description,
      brandName: t.brands.name,
      categoryName: t.categories.name,
      productTypeName: t.product_types.name,
      publishedAt: t.products.publishedAt,
      lastAggregatedAt: t.products.lastAggregatedAt,
      createdAt: t.products.createdAt,
      updatedAt: t.products.updatedAt,
    })
    .from(t.products)
    .leftJoin(t.brands, eq(t.products.brand, t.brands.id))
    .leftJoin(t.categories, eq(t.products.category, t.categories.id))
    .leftJoin(t.product_types, eq(t.products.productType, t.product_types.id))
    .where(eq(t.products.id, productId))
    .limit(1)

  if (!product) notFound()

  const ingredients = await db
    .select({ name: t.products_ingredients.name })
    .from(t.products_ingredients)
    .where(eq(t.products_ingredients._parentID, productId))

  const claims = await db
    .select({
      claim: t.products_product_claims.claim,
      evidenceType: t.products_product_claims.evidenceType,
      snippet: t.products_product_claims.snippet,
    })
    .from(t.products_product_claims)
    .where(eq(t.products_product_claims._parentID, productId))

  const attributes = await db
    .select({
      attribute: t.products_product_attributes.attribute,
      evidenceType: t.products_product_attributes.evidenceType,
      snippet: t.products_product_attributes.snippet,
    })
    .from(t.products_product_attributes)
    .where(eq(t.products_product_attributes._parentID, productId))

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null

  return (
    <div>
      <Link href="/products" className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">
        &larr; All products
      </Link>

      <h1 className="text-3xl font-bold tracking-tight mb-1">{product.name || 'Unnamed product'}</h1>
      {product.gtin && (
        <p className="text-muted-foreground mb-6">
          GTIN <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{product.gtin}</code>
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {[
                ['Brand', product.brandName],
                ['Category', product.categoryName],
                ['Product Type', product.productTypeName],
                ['Published', formatDate(product.publishedAt)],
                ['Last Aggregated', formatDate(product.lastAggregatedAt)],
                ['Created', formatDate(product.createdAt)],
              ].map(([label, value]) => (
                <React.Fragment key={label as string}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{(value as string) || <span className="text-muted-foreground">—</span>}</dd>
                </React.Fragment>
              ))}
            </dl>
          </CardContent>
        </Card>

        {product.description && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{product.description}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Separator className="mb-8" />

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">
          Ingredients
          <span className="text-muted-foreground font-normal text-base ml-2">({ingredients.length})</span>
        </h2>
        {ingredients.length > 0 ? (
          <p className="text-sm leading-relaxed">
            {ingredients.map((ing, i) => (
              <span key={i}>
                {ing.name}
                {i < ingredients.length - 1 && <span className="text-muted-foreground">, </span>}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No ingredients listed</p>
        )}
      </section>

      {claims.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Claims</h2>
          <div className="flex flex-wrap gap-2">
            {claims.map((c, i) => (
              <Badge key={i} variant="secondary">
                {c.claim}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {attributes.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Attributes</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attribute</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Snippet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attributes.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{a.attribute}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{a.evidenceType}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {a.snippet || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  )
}
