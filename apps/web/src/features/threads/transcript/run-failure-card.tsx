'use client'

import { CircleAlertIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

export interface RunFailureCardProps {
  title: string
  detail: string
  meta?: string | undefined
  onDismiss?: (() => void) | undefined
}

export function RunFailureCard({ title, detail, meta, onDismiss }: RunFailureCardProps) {
  return (
    <section
      aria-label="Run failure"
      className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2"
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
        {meta === undefined ? null : (
          <span className="font-mono text-xs text-muted-foreground">{meta}</span>
        )}
      </div>
      {onDismiss === undefined ? null : (
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
          <XIcon />
        </Button>
      )}
    </section>
  )
}
