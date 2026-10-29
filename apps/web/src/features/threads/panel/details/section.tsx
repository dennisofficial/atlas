import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

export function DetailsSection(props: {
  title: string
  count?: string | number
  children: ReactNode
}) {
  return (
    <section aria-label={props.title} className="flex flex-col gap-1">
      <h3 className="flex items-baseline gap-1.5 text-xs font-medium text-muted-foreground">
        {props.title}
        {props.count === undefined ? null : <span className="tabular-nums">{props.count}</span>}
      </h3>
      {props.children}
    </section>
  )
}

export function RowButton(props: {
  onClick: () => void
  children: ReactNode
  label?: string
  current?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={props.label}
      aria-current={props.current ? 'true' : undefined}
      className="w-full justify-start font-normal"
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  )
}

export function Muted(props: { children: ReactNode }) {
  return <p className="px-1 text-sm text-muted-foreground">{props.children}</p>
}
