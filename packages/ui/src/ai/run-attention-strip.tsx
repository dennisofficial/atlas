import { CircleAlertIcon, LoaderCircleIcon, XIcon } from 'lucide-react'

import { Button } from '#components/button'

export interface RunAttentionAction {
  id: string
  label: string
  primary: boolean
  disabled: boolean
  pending?: boolean
  pendingLabel?: string
  onSelect: () => void
}

export interface RunAttentionStripProps {
  title: string
  detail: string
  meta?: string
  actions: RunAttentionAction[]
  onDismiss?: () => void
  busyReason?: string | null
}

export function RunAttentionStrip({
  title,
  detail,
  meta,
  actions,
  onDismiss,
  busyReason = null,
}: RunAttentionStripProps) {
  return (
    <section
      aria-label="Run failure"
      data-slot="run-attention-strip"
      className="-mb-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-t-xl border border-b-0 border-destructive/30 bg-destructive/10 px-3 pt-2 pb-3"
    >
      <CircleAlertIcon className="size-4 shrink-0 text-destructive" aria-hidden />
      <div className="flex min-w-48 flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{busyReason ?? detail}</span>
      </div>
      {meta === undefined ? null : (
        <span className="font-mono text-xs text-muted-foreground">{meta}</span>
      )}
      <div className="flex items-center gap-1.5">
        {actions.map((action) => (
          <RunAttentionActionButton key={action.id} action={action} busyReason={busyReason} />
        ))}
        {onDismiss === undefined ? null : (
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
            <XIcon />
          </Button>
        )}
      </div>
    </section>
  )
}

interface RunAttentionActionButtonProps {
  action: RunAttentionAction
  busyReason: string | null
}

function RunAttentionActionButton({ action, busyReason }: RunAttentionActionButtonProps) {
  const pending = action.pending === true
  const title = action.disabled && !pending ? (busyReason ?? undefined) : undefined
  return (
    <Button
      size="sm"
      variant={action.primary ? 'default' : 'outline'}
      disabled={action.disabled || pending}
      title={title}
      onClick={action.onSelect}
    >
      {pending ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : null}
      {pending ? (action.pendingLabel ?? action.label) : action.label}
    </Button>
  )
}
