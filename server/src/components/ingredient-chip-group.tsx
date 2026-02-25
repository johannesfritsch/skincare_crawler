'use client'

import React, { useState, useCallback } from 'react'
import { ChevronDown, FlaskConical, AlertTriangle } from 'lucide-react'
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

/* ── Types ── */

export interface IngredientItem {
  name: string
  description: string | null
  casNumber: string | null
  restrictions: string | null
  functions: string | null
  hasData: boolean
}

/* ── Collapsible row inside the modal ── */

function IngredientRow({
  item,
  index,
  open,
  onToggle,
}: {
  item: IngredientItem
  index: number
  open: boolean
  onToggle: () => void
}) {
  const hasRestrictions = !!item.restrictions

  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted/60 touch-manipulation',
          open ? 'bg-muted/40' : 'hover:bg-muted/30',
        )}
      >
        <span className="text-[11px] font-mono text-muted-foreground/60 w-5 text-right shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.name}</p>
          {item.functions && (
            <p className="text-[11px] text-muted-foreground truncate">{item.functions}</p>
          )}
        </div>
        {hasRestrictions && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        )}
        {item.hasData && (
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        )}
      </CollapsibleTrigger>
      {item.hasData && (
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="px-4 pb-3 pt-1 ml-8">
            <div className="rounded-xl bg-muted/30 p-3.5 space-y-2.5">
              {item.description && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              )}

              {item.functions && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-1">
                    Functions
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {item.functions.split(', ').map((fn, i) => (
                      <span
                        key={i}
                        className="inline-block rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {fn}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {item.casNumber && (
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-medium">CAS:</span> {item.casNumber}
                </p>
              )}

              {item.restrictions && (
                <div className="rounded-lg bg-amber-50 border border-amber-200/60 px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    <span className="text-[10px] font-medium text-amber-700 uppercase tracking-wide">
                      Restrictions
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    {item.restrictions}
                  </p>
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

/* ── IngredientChipGroup: tappable pills + bottom-sheet with full list ── */

export function IngredientChipGroup({ items }: { items: IngredientItem[] }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  const openSheet = useCallback((index: number) => {
    setExpandedIndex(index)
    setSheetOpen(true)
  }, [])

  if (items.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={() => openSheet(i)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              'active:scale-[0.97] touch-manipulation',
              item.restrictions
                ? 'bg-amber-50 border-amber-200/60 text-amber-800'
                : 'bg-muted/50 border-border text-muted-foreground',
            )}
          >
            {item.restrictions && (
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
            )}
            <span className="truncate max-w-[140px]">{item.name}</span>
          </button>
        ))}
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={(v) => {
          if (!v) {
            setSheetOpen(false)
            setExpandedIndex(null)
          }
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="rounded-t-2xl max-h-[85dvh] overflow-hidden flex flex-col !p-0"
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-0 shrink-0">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="pb-0 pt-2 px-4 shrink-0">
            <SheetTitle className="text-base">
              Ingredients
              <span className="text-sm font-normal text-muted-foreground ml-1.5">
                ({items.length})
              </span>
            </SheetTitle>
            <SheetDescription className="text-xs">
              Tap an ingredient for details
            </SheetDescription>
          </SheetHeader>

          {/* Scrollable list — full-bleed, no horizontal padding on container */}
          <div className="overflow-y-auto flex-1 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] mt-2">
            <div className="divide-y divide-border/50">
              {items.map((item, i) => (
                <IngredientRow
                  key={i}
                  item={item}
                  index={i}
                  open={expandedIndex === i}
                  onToggle={() =>
                    setExpandedIndex(expandedIndex === i ? null : i)
                  }
                />
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
