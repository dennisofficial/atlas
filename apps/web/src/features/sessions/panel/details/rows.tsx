'use client'

import { ChevronDownIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { RevealRows } from './reveal'

const VISIBLE_ROWS = 3

export const ROW_SURFACE =
  'rounded-lg hover:bg-muted hover:text-foreground focus-within:bg-muted focus-within:text-foreground dark:hover:bg-muted/50 dark:focus-within:bg-muted/50 transition-colors duration-150 motion-reduce:transition-none'

const ACTIONS_SHOWN = 'group-hover:flex group-focus-within:flex [@media(hover:none)]:flex'
const TRAILING_HIDDEN = 'group-hover:hidden group-focus-within:hidden [@media(hover:none)]:hidden'

export function SectionHead({ title, count }: { title: string; count?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-1.5">
      <h3 className="text-xs leading-4 font-medium text-foreground">{title}</h3>
      {count === undefined ? null : (
        <span className="text-xs leading-4 text-muted-foreground tabular-nums">{count}</span>
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
  actions?: ReactNode
  actionsVisible?: boolean
  label?: string
  onSelect?: (() => void) | undefined
}) {
  const layout = cn(
    'group relative grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 py-1',
    (props.actions !== undefined || props.onSelect !== undefined) &&
      cn('-mx-1.5 w-[calc(100%+0.75rem)] px-1.5', ROW_SURFACE),
  )
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
      <span
        data-row-trailing
        className={cn(
          'flex shrink-0 items-center gap-2 pt-0.5 text-[11px] leading-4 text-muted-foreground tabular-nums',
          props.actions !== undefined && !props.actionsVisible && TRAILING_HIDDEN,
        )}
      >
        {props.trailing}
      </span>
    )
  const actions =
    props.actions === undefined ? null : (
      <span
        data-row-actions
        className={cn(
          'h-4 shrink-0 items-center gap-1 text-[11px] leading-4 text-muted-foreground',
          props.actionsVisible ? 'flex' : cn('hidden', ACTIONS_SHOWN),
        )}
      >
        {props.actions}
      </span>
    )
  if (props.onSelect === undefined) {
    return (
      <div data-pane-row className={layout}>
        {leading}
        {title}
        <span className="flex items-center gap-1">
          {trailing}
          {actions}
        </span>
      </div>
    )
  }
  return (
    <div data-pane-row className={layout}>
      <button
        type="button"
        aria-label={props.label}
        onClick={props.onSelect}
        className="col-span-2 grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {leading}
        {title}
      </button>
      <span className="flex items-center gap-1">
        {trailing}
        {actions}
      </span>
    </div>
  )
}

export function FoldedRows<T>(props: {
  rows: readonly T[]
  minVisible?: number
  rowKey: (row: T) => string | number
  render: (row: T) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const visibleCount = Math.max(VISIBLE_ROWS, props.minVisible ?? 0)
  const visible = expanded ? props.rows : props.rows.slice(0, visibleCount)
  const handleToggle = () => setExpanded((held) => !held)

  return (
    <>
      <RevealRows rows={visible} rowKey={props.rowKey} render={props.render} />
      {props.rows.length > visibleCount ? (
        <RowsToggle expanded={expanded} onToggle={handleToggle}>
          {expanded ? 'Show fewer' : `Show all (${props.rows.length})`}
        </RowsToggle>
      ) : null}
    </>
  )
}

export function RowsToggle(props: {
  expanded: boolean
  onToggle: () => void
  children: ReactNode
  beforeRows?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-expanded={props.expanded}
      onClick={props.onToggle}
      className={cn(
        'ml-[1.125rem] w-fit text-muted-foreground',
        props.beforeRows ? 'mb-0.5' : 'mt-0.5',
      )}
    >
      {props.children}
    </Button>
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
