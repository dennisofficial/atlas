'use client'

import { ListCollapseIcon } from 'lucide-react'

import { Button } from '#components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip'

export const SUMMARISE_LABEL = 'Summarise'
export const SUMMARISE_UP_TO_LABEL = 'Summarise up to here'
export const SUMMARISE_FROM_LABEL = 'Summarise from here'

export interface SummariseActions {
  onSummariseUpTo?: (() => void) | undefined
  onSummariseFrom?: (() => void) | undefined
}

export const hasSummariseAction = (actions: SummariseActions): boolean =>
  Boolean(actions.onSummariseUpTo || actions.onSummariseFrom)

export function SummariseAction({ onSummariseUpTo, onSummariseFrom }: SummariseActions) {
  if (!hasSummariseAction({ onSummariseUpTo, onSummariseFrom })) return null
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={SUMMARISE_LABEL} />}
            />
          }
        >
          <ListCollapseIcon />
        </TooltipTrigger>
        <TooltipContent>{SUMMARISE_LABEL}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-auto">
        {onSummariseUpTo ? (
          <DropdownMenuItem onClick={onSummariseUpTo}>{SUMMARISE_UP_TO_LABEL}</DropdownMenuItem>
        ) : null}
        {onSummariseFrom ? (
          <DropdownMenuItem onClick={onSummariseFrom}>{SUMMARISE_FROM_LABEL}</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
