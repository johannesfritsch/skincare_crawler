import Image from 'next/image'
import Link from 'next/link'
import { Star } from 'lucide-react'

export interface ProductCardProps {
  gtin: string | null
  name: string | null
  brandName: string | null
  productTypeName?: string | null
  avgRating?: number | null
  totalReviews?: number | null
  imageUrl?: string | null
}

export function ProductCard({
  gtin,
  name,
  brandName,
  productTypeName,
  avgRating,
  totalReviews,
  imageUrl,
}: ProductCardProps) {
  return (
    <Link
      href={`/products/${gtin}`}
      className="snap-start shrink-0 w-40 rounded-xl border bg-card p-3 transition-colors active:bg-muted/60"
    >
      <div className="aspect-[4/3] rounded-lg bg-muted/50 flex items-center justify-center mb-2.5 overflow-hidden p-2">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={name ?? 'Product image'}
            width={320}
            height={240}
            className="h-full w-full object-contain"
            sizes="160px"
          />
        ) : (
          <span className="text-2xl font-semibold text-muted-foreground/30">
            {(name ?? '?')[0]?.toUpperCase()}
          </span>
        )}
      </div>
      <p className="text-sm font-medium leading-tight line-clamp-2">{name}</p>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">{brandName ?? 'No brand'}</p>
      <div className="flex items-center gap-1.5 mt-1.5 min-h-[1.25rem]">
        {avgRating != null && avgRating > 0 ? (
          <>
            <div className="flex items-center gap-0.5">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="text-xs font-semibold">{avgRating}</span>
            </div>
            {totalReviews != null && totalReviews > 0 && (
              <span className="text-[11px] text-muted-foreground">
                ({totalReviews.toLocaleString('de-DE')})
              </span>
            )}
          </>
        ) : productTypeName ? (
          <span className="text-[11px] text-muted-foreground/70 truncate">{productTypeName}</span>
        ) : null}
      </div>
    </Link>
  )
}
