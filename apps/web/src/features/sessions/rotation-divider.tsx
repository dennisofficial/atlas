'use client'

import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Card, CardContent } from '@dltech/atlas-ui/components/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@dltech/atlas-ui/components/collapsible'

import type { RotationItem } from '../threads/data/transcript-items'

const RULE = 'h-px min-w-8 flex-1 bg-border'

export function RotationDivider(args: { item: RotationItem; timestamp: string | undefined }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
        <span className={RULE} aria-hidden="true" />
        <span data-slot="rotation-label" className="shrink-0">
          {args.item.text}
        </span>
        {args.timestamp === undefined ? null : (
          <span className="shrink-0 tabular-nums text-muted-foreground/70">{args.timestamp}</span>
        )}
        <span className={RULE} aria-hidden="true" />
      </div>
      <Card size="sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">The handoff brief</span>
          <CollapsibleTrigger render={<Button size="xs" variant="ghost" />}>
            {open ? 'Hide brief' : 'Show brief'}
            <ChevronDownIcon
              className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
            {args.item.handoff}
          </CardContent>
          {args.item.instructions === undefined ? null : (
            <CardContent className="whitespace-pre-wrap text-sm text-foreground">
              {args.item.instructions}
            </CardContent>
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
