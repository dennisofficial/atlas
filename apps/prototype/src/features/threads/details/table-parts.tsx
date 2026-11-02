import type { ReactElement, ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

export const MID_COLUMN = 'hidden @[480px]:table-cell'
export const WIDE_COLUMN = 'hidden @[640px]:table-cell'
export const HEAD_CELL = 'h-7 px-1 text-xs font-normal text-muted-foreground'
export const BODY_CELL = 'px-1 py-1'

export function IconAction(props: {
  label: string
  icon: ReactElement
  onClick?: () => void
  pressed?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={props.label}
            aria-pressed={props.pressed}
            onClick={props.onClick}
            disabled={props.disabled}
          />
        }
      >
        {props.icon}
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

export function ToggleRow(props: { colSpan: number; label: string; onToggle: () => void }) {
  return (
    <tr className="border-b">
      <td colSpan={props.colSpan} className="px-1 py-0.5">
        <button
          type="button"
          onClick={props.onToggle}
          className="w-full rounded-md px-1 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {props.label}
        </button>
      </td>
    </tr>
  )
}

export function Mono(props: { children: ReactNode }) {
  return (
    <span className="font-mono text-xs text-muted-foreground tabular-nums">{props.children}</span>
  )
}
