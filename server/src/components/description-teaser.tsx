'use client'

import React, { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

const TEASER_LENGTH = 100

interface DescriptionTeaserProps {
  description: string
}

export function DescriptionTeaser({ description }: DescriptionTeaserProps) {
  const [open, setOpen] = useState(false)

  const needsTruncation = description.length > TEASER_LENGTH
  const teaser = needsTruncation
    ? description.slice(0, TEASER_LENGTH).replace(/\s+\S*$/, '') + '...'
    : description

  return (
    <>
      <p className="text-xs leading-relaxed text-muted-foreground mt-1">
        {teaser}
        {needsTruncation && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-1 text-xs font-medium text-primary active:opacity-70 touch-manipulation"
          >
            more
          </button>
        )}
      </p>

      {needsTruncation && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl max-h-[85dvh] overflow-hidden flex flex-col px-6">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-0">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            <SheetHeader className="px-0 pb-0 pt-2">
              <SheetTitle className="text-base">Description</SheetTitle>
              <SheetDescription className="sr-only">Full product description</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto flex-1 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {description}
              </p>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}
