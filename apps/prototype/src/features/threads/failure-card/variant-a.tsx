import { LoaderCircleIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Kbd } from '@dltech/atlas-ui/components/kbd'

import { ActionButton } from './action-button'
import { actionsOf, BUSY_REASON, EFailureAction, metaOf, type FailureScenario } from './scenarios'
import type { FailureCardProps } from './use-failure-state'

export const NAME_A = 'Inline card (TUI style)'

export function VariantA({ scenario, status, onAction, onDismiss }: FailureCardProps) {
  const actions = actionsOf({ scenario, status })
  const retry = actions.find((action) => action.kind === EFailureAction.Retry)
  const handleOpenAgent = () => onAction(EFailureAction.OpenAgent)
  return (
    <section
      aria-label="Run failure"
      className="relative flex flex-col gap-2 overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5 py-3 pr-3 pl-5"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-destructive" />
      <header className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium text-destructive">✗ failed</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{scenario.title}</span>
        <span className="font-mono text-xs text-muted-foreground">{metaOf(scenario)}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
          <XIcon />
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{scenario.detail}</p>
      {scenario.subAgent === undefined ? null : (
        <button
          type="button"
          onClick={handleOpenAgent}
          className="w-fit rounded-md text-left font-mono text-xs text-destructive underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          ↳ {scenario.subAgent.name} · {scenario.subAgent.cause}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {actions.map((action) => (
          <ActionButton key={action.kind} action={action} status={status} onAction={onAction} />
        ))}
        {retry === undefined ? null : <RetryHint scenario={scenario} />}
      </div>
    </section>
  )
}

function RetryHint({ scenario }: { scenario: FailureScenario }) {
  if (scenario.busy === true) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircleIcon className="size-3 animate-spin" />
        {BUSY_REASON}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Kbd>ctrl+r</Kbd> retry
    </span>
  )
}
