import { ChevronDownIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

const VISIBLE_ROWS = 3

export function SectionHead(props: {
  title: string
  count: number
  open?: boolean
  onToggle?: () => void
}) {
  const inner = (
    <>
      <span className="flex items-center gap-1">
        <h3 className="text-[11px] leading-4 font-medium text-muted-foreground">{props.title}</h3>
        {props.onToggle === undefined ? null : (
          <ChevronDownIcon
            aria-hidden
            className={cn(
              'size-3 text-muted-foreground transition-transform',
              props.open !== true && '-rotate-90',
            )}
          />
        )}
      </span>
      <span className="text-[11px] leading-4 text-muted-foreground/70 tabular-nums">
        {props.count}
      </span>
    </>
  )

  if (props.onToggle === undefined) {
    return <div className="flex items-baseline justify-between gap-3 pb-1">{inner}</div>
  }

  return (
    <button
      type="button"
      aria-expanded={props.open}
      onClick={props.onToggle}
      className={cn(
        'flex w-full items-baseline justify-between gap-3 rounded-sm pb-1 text-left outline-none',
        'hover:[&_h3]:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
    >
      {inner}
    </button>
  )
}

export function Row(props: {
  leading: ReactNode
  title: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-sm py-1">
      <span className="flex h-4 items-center justify-center text-muted-foreground">
        {props.leading}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] leading-4">{props.title}</span>
        {props.meta === undefined ? null : (
          <span className="truncate text-[11px] leading-4 text-muted-foreground">{props.meta}</span>
        )}
      </span>
      {props.trailing === undefined ? null : (
        <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
          {props.trailing}
        </span>
      )}
    </div>
  )
}

export function FoldedRows<T>(props: { rows: T[]; render: (row: T) => ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? props.rows : props.rows.slice(0, VISIBLE_ROWS)

  return (
    <>
      {visible.map((row) => props.render(row))}
      {props.rows.length > VISIBLE_ROWS ? (
        <button
          type="button"
          onClick={() => setExpanded((held) => !held)}
          className="mt-0.5 ml-[1.625rem] w-fit rounded-sm text-[11px] leading-4 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? 'Show fewer' : `Show all (${props.rows.length})`}
        </button>
      ) : null}
    </>
  )
}
