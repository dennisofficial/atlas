'use client'

import { CircleAlertIcon, XIcon } from 'lucide-react'

import type { RunAttentionAction } from '@dltech/atlas-ui/ai/run-attention-strip'
import { Button } from '@dltech/atlas-ui/components/button'

export interface RunFailureCardProps {
  title: string
  detail: string
  meta?: string | undefined
  actions?: readonly RunAttentionAction[] | undefined
  onDismiss?: (() => void) | undefined
}

const ActionButton = ({ action }: { action: RunAttentionAction }) => (
  <Button
    size="sm"
    variant={action.primary ? 'default' : 'outline'}
    disabled={action.disabled || action.pending === true}
    onClick={action.onSelect}
  >
    {action.pending === true ? (action.pendingLabel ?? action.label) : action.label}
  </Button>
)

export function RunFailureCard({ title, detail, meta, actions, onDismiss }: RunFailureCardProps) {
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
        {actions === undefined || actions.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {actions.map((action) => (
              <ActionButton key={action.id} action={action} />
            ))}
          </div>
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
