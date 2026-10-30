import { CircleAlertIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { ActionButton } from './action-button'
import { actionsOf, BUSY_REASON, metaOf } from './scenarios'
import type { FailureCardProps } from './use-failure-state'

export const NAME_B = 'Composer strip'

export function ComposerStrip({ scenario, status, onAction, onDismiss }: FailureCardProps) {
  const actions = actionsOf({ scenario, status })
  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <section
        aria-label="Run failure"
        className="-mb-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-t-xl border border-b-0 border-destructive/30 bg-destructive/10 px-3 pt-2 pb-3"
      >
        <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
        <div className="flex min-w-48 flex-1 flex-col">
          <span className="text-sm font-medium">{scenario.title}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {scenario.busy === true ? BUSY_REASON : scenario.detail}
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">{metaOf(scenario)}</span>
        <div className="flex items-center gap-1.5">
          {actions.map((action) => (
            <ActionButton
              key={action.kind}
              action={action}
              status={status}
              onAction={onAction}
              short
            />
          ))}
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
            <XIcon />
          </Button>
        </div>
      </section>
    </div>
  )
}

export function TurnMarkerB({ elapsed }: { elapsed: string }) {
  return <p className="font-mono text-xs text-destructive">✗ run failed after {elapsed}</p>
}
