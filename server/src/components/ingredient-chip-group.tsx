'use client'

import React, { useState, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

/* ── Types ── */

export interface IngredientItem {
  name: string
  description: string | null
  casNumber: string | null
  restrictions: string | null
  functions: string | null
  hasData: boolean
}

/* ── Single ingredient detail (shown in bottom sheet) ── */

function IngredientDetail({ item }: { item: IngredientItem }) {
  return (
    <div className="space-y-3">
      {item.description && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      )}

      {item.functions && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-1.5">
            Functions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {item.functions.split(', ').map((fn, i) => (
              <span
                key={i}
                className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {fn}
              </span>
            ))}
          </div>
        </div>
      )}

      {item.casNumber && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">CAS:</span> {item.casNumber}
        </p>
      )}

      {item.restrictions && (
        <div className="rounded-lg bg-amber-50 border border-amber-200/60 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <span className="text-[10px] font-medium text-amber-700 uppercase tracking-wide">
              Restrictions
            </span>
          </div>
          <p className="text-xs leading-relaxed text-amber-800">
            {item.restrictions}
          </p>
        </div>
      )}

      {!item.description && !item.functions && !item.casNumber && !item.restrictions && (
        <p className="text-sm text-muted-foreground">No additional data available for this ingredient.</p>
      )}
    </div>
  )
}

/* ── Ingredient row in the main list ── */

function IngredientRow({
  item,
  index,
  onTap,
}: {
  item: IngredientItem
  index: number
  onTap: () => void
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
        'active:bg-muted/60 touch-manipulation hover:bg-muted/30',
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
      {item.restrictions && (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
    </button>
  )
}

/* ── IngredientChipGroup: list in card + detail bottom-sheet ── */

export function IngredientChipGroup({ items }: { items: IngredientItem[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const openDetail = useCallback((index: number) => {
    setSelectedIndex(index)
  }, [])

  if (items.length === 0) return null

  const selectedItem = selectedIndex != null ? items[selectedIndex] : null

  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden divide-y divide-border/50">
        {items.map((item, i) => (
          <IngredientRow
            key={i}
            item={item}
            index={i}
            onTap={() => openDetail(i)}
          />
        ))}
      </div>

      <Sheet
        open={selectedIndex != null}
        onOpenChange={(v) => {
          if (!v) setSelectedIndex(null)
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="rounded-t-2xl max-h-[70dvh] overflow-hidden flex flex-col !p-0"
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-0 shrink-0">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="pb-0 pt-2 px-4 shrink-0">
            <SheetTitle className="text-base">
              {selectedItem?.name}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Ingredient details
            </SheetDescription>
          </SheetHeader>

          <div className="overflow-y-auto flex-1 px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
            {selectedItem && <IngredientDetail item={selectedItem} />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
