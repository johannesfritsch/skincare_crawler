import Image from 'next/image'
import Link from 'next/link'
import { ShoppingBag, Star, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { scoreTier, tierBadgeBg, tierTextColor } from '@/lib/score-utils'

export interface ProductCardProps {
  gtin: string | null
  name: string | null
  brandName: string | null
  productTypeName?: string | null
  /** Creator sentiment score on 0–10 scale (null = no creator reviews) */
  creatorScore?: number | null
  /** Store rating on 0–10 scale (null = no store ratings) */
  storeScore?: number | null
  imageUrl?: string | null
  /** Extra classes on the outer Link (e.g. fixed width for carousels) */
  className?: string
}

/** Tiny tier-colored pill: [star] score [type-icon] */
function ScorePill({ score, typeIcon, gold }: {
  score: number
  typeIcon: React.ReactNode
  gold?: boolean
}) {
  const n = Number(score)
  const tier = scoreTier(n, { gold })
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 rounded-md border px-1 py-0.5',
      tierBadgeBg[tier],
    )}>
      <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
      <span className={cn('text-[10px] font-bold leading-none', tierTextColor[tier])}>
        {n.toFixed(1)}
      </span>
      <span className="text-muted-foreground/60">{typeIcon}</span>
    </span>
  )
}

export function ProductCard({
  gtin,
  name,
  brandName,
  productTypeName,
  creatorScore,
  storeScore,
  imageUrl,
  className,
}: ProductCardProps) {
  const hasStoreScore = storeScore != null && Number(storeScore) > 0
  const hasCreatorScore = creatorScore != null
  const hasAnyScore = hasStoreScore || hasCreatorScore

  return (
    <Link
      href={`/products/${gtin}`}
      className={cn('rounded-xl border bg-card p-3 transition-colors active:bg-muted/60', className)}
    >
      {/* Image */}
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

      {/* Name + brand */}
      <p className="text-sm font-medium leading-tight line-clamp-2">{name}</p>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">{brandName ?? 'No brand'}</p>

      {/* Score pills — single row */}
      <div className="flex items-center gap-1 mt-1.5">
        {hasStoreScore && (
          <ScorePill
            score={storeScore}
            typeIcon={<ShoppingBag className="h-2.5 w-2.5" />}
          />
        )}
        {hasCreatorScore && (
          <ScorePill
            score={creatorScore}
            typeIcon={<Users className="h-2.5 w-2.5" />}
            gold
          />
        )}
        {!hasAnyScore && productTypeName && (
          <span className="text-[10px] text-muted-foreground/70 truncate">{productTypeName}</span>
        )}
      </div>
    </Link>
  )
}
