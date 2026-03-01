'use client'

import React, { useState } from 'react'
import {
  AlertTriangle,
  Wine,
  Wheat,
  Droplets,
  FlaskConical,
  ShieldAlert,
  TestTubes,
  Flower2,
  Fuel,
  Leaf,
  Heart,
  Baby,
  ShieldCheck,
  CloudRain,
  Trash2,
  ShieldOff,
  GlassWater,
  FlaskRound,
  FileText,
  ChevronDown,
  Quote,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { StoreLogo } from '@/components/store-logos'
import { storeLabel } from '@/lib/score-utils'
import type { TraitIcon } from '@/lib/product-traits'

/* ── Icon lookup ── */

const ICON_MAP: Record<TraitIcon, LucideIcon> = {
  'alert-triangle': AlertTriangle,
  'wine': Wine,
  'wheat': Wheat,
  'droplets': Droplets,
  'flask-conical': FlaskConical,
  'shield-alert': ShieldAlert,
  'test-tubes': TestTubes,
  'flower-2': Flower2,
  'fuel': Fuel,
  'leaf': Leaf,
  'heart': Heart,
  'baby': Baby,
  'shield-check': ShieldCheck,
  'cloud-rain': CloudRain,
  'trash-2': Trash2,
  'shield-off': ShieldOff,
  'glass-water': GlassWater,
}

/* ── Evidence types ── */

export interface TraitEvidence {
  /** Store slug: 'dm' | 'rossmann' | 'mueller' */
  sourceName: string | null
  evidenceType: string | null
  /** For descriptionSnippet: the verbatim snippet */
  snippet?: string | null
  /** Character offsets into the source description (0-based, end exclusive) */
  start?: number | null
  end?: number | null
  /** For ingredient evidence */
  ingredientNames?: string[]
}

export interface TraitItem {
  id: string
  title: string
  description: string
  icon: TraitIcon
  tone: 'positive' | 'negative' | 'neutral'
  kind: 'attribute' | 'claim'
  evidence?: TraitEvidence
}

/* ── Shared styles ── */

const toneBg = {
  positive: 'bg-emerald-50 border-emerald-200/60 text-emerald-800',
  negative: 'bg-amber-50 border-amber-200/60 text-amber-800',
  neutral: 'bg-muted/50 border-border text-muted-foreground',
} as const

const toneIcon = {
  positive: 'text-emerald-600',
  negative: 'text-amber-600',
  neutral: 'text-muted-foreground',
} as const

const toneHighlight = {
  positive: 'bg-emerald-200/60',
  negative: 'bg-amber-200/60',
  neutral: 'bg-muted',
} as const



/* ── Tone-aware border color for quote block ── */

const toneBorder = {
  positive: 'border-emerald-300',
  negative: 'border-amber-300',
  neutral: 'border-border',
} as const

const toneBgSubtle = {
  positive: 'bg-emerald-50/60',
  negative: 'bg-amber-50/60',
  neutral: 'bg-muted/30',
} as const

/* ── Source attribution row (icon + store name) ── */

function SourceAttribution({ sourceName }: { sourceName: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <div className="flex items-center justify-center shrink-0 rounded-md bg-white border border-border/60 size-7 p-1">
        <StoreLogo source={sourceName} className="!h-4" />
      </div>
      <span className="text-xs text-muted-foreground font-medium">
        {storeLabel(sourceName)}
      </span>
    </div>
  )
}

/* ── Evidence detail (reused inside each collapsible row) ── */

function EvidenceDetail({ evidence, tone, kind }: {
  evidence?: TraitEvidence
  tone: 'positive' | 'negative' | 'neutral'
  kind: 'attribute' | 'claim'
}) {
  const hasEvidence = evidence && (
    (evidence.evidenceType === 'ingredient' && evidence.ingredientNames && evidence.ingredientNames.length > 0) ||
    (evidence.evidenceType === 'descriptionSnippet' && evidence.snippet)
  )

  if (!hasEvidence) {
    return (
      <div className={cn('rounded-xl p-3.5', toneBgSubtle[tone])}>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {kind === 'attribute'
            ? 'Based on ingredient analysis'
            : 'Based on product marketing claims'}
        </p>
        {evidence?.sourceName && <SourceAttribution sourceName={evidence.sourceName} />}
      </div>
    )
  }

  return (
    <div className={cn('rounded-xl p-3.5 space-y-3', toneBgSubtle[tone])}>
      {/* Quote block */}
      <div className={cn('border-l-[3px] pl-3.5', toneBorder[tone])}>
        {evidence.evidenceType === 'ingredient' && evidence.ingredientNames && evidence.ingredientNames.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <FlaskRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Detected ingredients
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {evidence.ingredientNames.map((name, i) => (
                <span
                  key={i}
                  className={cn(
                    'inline-block rounded-md px-2 py-0.5 text-xs font-medium',
                    toneHighlight[tone],
                  )}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {evidence.evidenceType === 'descriptionSnippet' && evidence.snippet && (
          <div className="space-y-1.5">
            <Quote className="h-4 w-4 text-muted-foreground/50" />
            <p className="text-[13px] leading-relaxed text-foreground/80 italic">
              {evidence.snippet}
            </p>
          </div>
        )}
      </div>

      {/* Source attribution */}
      {evidence.sourceName && <SourceAttribution sourceName={evidence.sourceName} />}
    </div>
  )
}

/* ── Collapsible row inside the modal ── */

function TraitRow({ item, open, onToggle }: { item: TraitItem; open: boolean; onToggle: () => void }) {
  const Icon = ICON_MAP[item.icon]

  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-muted/60 touch-manipulation',
        open ? 'bg-muted/40' : 'hover:bg-muted/30',
      )}>
        <div className={cn(
          'flex items-center justify-center shrink-0 rounded-full size-8 border',
          toneBg[item.tone],
        )}>
          <Icon className={cn('h-4 w-4', toneIcon[item.tone])} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{item.title}</p>
          <p className="text-xs text-muted-foreground truncate">{item.description}</p>
        </div>
        <ChevronDown className={cn(
          'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180',
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="pl-3 pr-3 pb-3 pt-1.5">
          <EvidenceDetail evidence={item.evidence} tone={item.tone} kind={item.kind} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/* ── TraitChipGroup: renders all chips + a shared bottom-sheet modal ── */

export function TraitChipGroup({ items }: { items: TraitItem[] }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (items.length === 0) return null

  function openSheet(id: string) {
    setExpandedId(id)
    setSheetOpen(true)
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const Icon = ICON_MAP[item.icon]
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => openSheet(item.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                'active:scale-[0.97] touch-manipulation',
                toneBg[item.tone],
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0', toneIcon[item.tone])} />
              <span>{item.title}</span>
            </button>
          )
        })}
      </div>

      <Sheet open={sheetOpen} onOpenChange={(v) => { if (!v) { setSheetOpen(false); setExpandedId(null) } }}>
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl max-h-[85dvh] overflow-hidden flex flex-col">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-0">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="pb-0 pt-2">
            <SheetTitle className="text-base">Product Traits</SheetTitle>
            <SheetDescription className="text-xs">
              {items.filter(i => i.kind === 'attribute').length > 0 && items.filter(i => i.kind === 'claim').length > 0
                ? 'Attributes based on ingredients & marketing claims'
                : items.some(i => i.kind === 'attribute')
                  ? 'Attributes based on ingredient analysis'
                  : 'Based on product marketing claims'}
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto flex-1 -mx-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <div className="divide-y divide-border/50">
              {items.map((item) => (
                <div key={item.id} className="py-0.5 first:pt-0 last:pb-0">
                  <TraitRow
                    item={item}
                    open={expandedId === item.id}
                    onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
