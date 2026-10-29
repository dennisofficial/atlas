import type { ReactNode } from 'react'

import { cn } from '#lib/utils'

export interface DetailRowProps {
  label: ReactNode
  icon?: ReactNode
  meta?: ReactNode
  detail?: ReactNode
  actions?: ReactNode
  revealActions?: boolean
  mono?: boolean
  indent?: number
  current?: boolean
  title?: string
  ariaLabel?: string
  onClick?: () => void
}

const ROW =
  'group/detail-row flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-normal transition-colors outline-none'

const INTERACTIVE =
  'cursor-pointer hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current=true]:bg-muted'

function Body(props: DetailRowProps) {
  const { label, icon, meta, detail, mono, indent } = props
  return (
    <>
      {indent === undefined || indent === 0 ? null : (
        <span aria-hidden className="shrink-0" style={{ width: `${indent}px` }} />
      )}
      {icon === undefined ? null : (
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:shrink-0">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate', mono === true && 'font-mono')}>{label}</span>
        {detail === undefined ? null : (
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        )}
      </span>
      {meta === undefined ? null : (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>
      )}
    </>
  )
}

export function DetailRow(props: DetailRowProps) {
  const { actions, revealActions, onClick, current, title, ariaLabel } = props
  if (onClick !== undefined && actions === undefined) {
    return (
      <button
        type="button"
        title={title}
        aria-label={ariaLabel}
        aria-current={current === true ? 'true' : undefined}
        className={cn(ROW, INTERACTIVE)}
        onClick={onClick}
      >
        <Body {...props} />
      </button>
    )
  }
  return (
    <div title={title} className={ROW}>
      <Body {...props} />
      {actions === undefined ? null : (
        <span
          className={cn(
            'flex shrink-0 items-center gap-1',
            revealActions === true &&
              'opacity-0 transition-opacity group-focus-within/detail-row:opacity-100 group-hover/detail-row:opacity-100 pointer-coarse:opacity-100',
          )}
        >
          {actions}
        </span>
      )}
    </div>
  )
}
