'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface AccordionSectionProps {
  title: React.ReactNode
  /** Extra content rendered on the right side of the header (e.g. count badge) */
  trailing?: React.ReactNode
  /** Whether the section starts open. Default: false */
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
}

export function AccordionSection({
  title,
  trailing,
  defaultOpen = false,
  children,
  className,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl bg-muted/40 px-4 py-3 transition-colors active:bg-muted/60">
        <div className="flex items-center gap-2 min-w-0">
          {typeof title === 'string' ? (
            <span className="text-sm font-semibold">{title}</span>
          ) : (
            title
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {trailing}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="pt-3">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
