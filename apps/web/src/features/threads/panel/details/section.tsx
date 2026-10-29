import type { ReactNode } from 'react'

export function DetailsSection(props: {
  title: string
  count?: string | number
  children: ReactNode
}) {
  return (
    <section aria-label={props.title} className="flex flex-col gap-0.5">
      <div className="flex flex-col px-1 pb-1">
        <h3 className="flex items-baseline gap-1.5 text-xs font-medium text-muted-foreground">
          {props.title}
          {props.count === undefined ? null : <span className="tabular-nums">{props.count}</span>}
        </h3>
      </div>
      {props.children}
    </section>
  )
}

export function Muted(props: { children: ReactNode }) {
  return <p className="px-1 text-sm text-muted-foreground">{props.children}</p>
}
