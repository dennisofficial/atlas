'use client'

import { ListCollapseIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip'

export const SUMMARISE_LABEL = 'Summarise up to here'

export interface SummariseActions {
  onSummariseUpTo?: (() => void) | undefined
}

export const hasSummariseAction = (actions: SummariseActions): boolean =>
  actions.onSummariseUpTo !== undefined

export function SummariseAction({ onSummariseUpTo }: SummariseActions) {
  if (onSummariseUpTo === undefined) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={SUMMARISE_LABEL}
            onClick={onSummariseUpTo}
          />
        }
      >
        <ListCollapseIcon />
      </TooltipTrigger>
      <TooltipContent>{SUMMARISE_LABEL}</TooltipContent>
    </Tooltip>
  )
}
