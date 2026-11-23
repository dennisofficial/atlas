'use client'

import { ChevronDownIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

const VISIBLE_ROWS = 3

export function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-1">
      <h3 className="text-[11px] leading-4 font-medium text-muted-foreground">{title}</h3>
      {count === undefined ? null : (
        <span className="text-[11px] leading-4 text-muted-foreground/70 tabular-nums">{count}</span>
      )}
    </div>
  )
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-4 text-muted-foreground">{children}</p>
}

export function Row(props: {
  leading: ReactNode
  title: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  label?: string
  onSelect?: (() => void) | undefined
}) {
  const layout = 'grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 py-1'
  const leading = (
    <span className="flex h-4 items-center justify-center text-muted-foreground">
      {props.leading}
    </span>
  )
  const title = (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[13px] leading-4">{props.title}</span>
      {props.meta === undefined ? null : (
        <span className="truncate text-[11px] leading-4 text-muted-foreground">{props.meta}</span>
      )}
    </span>
  )
  const trailing =
    props.trailing === undefined ? null : (
      <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
        {props.trailing}
      </span>
    )
  if (props.onSelect === undefined) {
    return (
      <div data-pane-row className={layout}>
        {leading}
        {title}
        {trailing}
      </div>
    )
  }
  return (
    <div
      data-pane-row
      className={cn(
        layout,
        'group -mx-1.5 w-[calc(100%+0.75rem)] rounded-md px-1.5 hover:bg-muted',
      )}
    >
      <button
        type="button"
        aria-label={props.label}
        onClick={props.onSelect}
        className="col-span-2 grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {leading}
        {title}
      </button>
      {trailing}
    </div>
  )
}

export function FoldedRows<T>(props: { rows: readonly T[]; render: (row: T) => ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? props.rows : props.rows.slice(0, VISIBLE_ROWS)
  const handleToggle = () => setExpanded((held) => !held)

  return (
    <>
      {visible.map((row) => props.render(row))}
      {props.rows.length > VISIBLE_ROWS ? (
        <button
          type="button"
          onClick={handleToggle}
          className="mt-0.5 ml-[1.625rem] w-fit rounded-sm text-[11px] leading-4 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? 'Show fewer' : `Show all (${props.rows.length})`}
        </button>
      ) : null}
    </>
  )
}

export function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      data-pane-pill
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10px] leading-none',
        tone,
      )}
    >
      {label}
    </span>
  )
}

export const Dot = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn('size-2 rounded-full', className)} />
)

export { ChevronDownIcon }
