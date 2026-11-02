import type { ReactNode, Ref } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

export function DetailsSection(props: {
  title: string
  ref?: Ref<HTMLElement>
  count?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section
      ref={props.ref}
      aria-label={props.title}
      className={cn('flex flex-col gap-0.5', props.className)}
    >
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
