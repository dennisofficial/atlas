import { useState } from 'react'
import { ChevronRightIcon, CircleAlertIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ActionButton } from './action-button'
import { actionsOf, EFailureAction, metaOf, type FailureScenario } from './scenarios'
import type { FailureCardProps } from './use-failure-state'

export const NAME_C = 'Turn row, expandable'

function detailRows(scenario: FailureScenario): [string, string][] {
  const { failure } = scenario
  const rows: [string, string][] = [
    ['Status code', failure?.statusCode === undefined ? '—' : String(failure.statusCode)],
    ['Provider code', failure?.providerCode ?? '—'],
    ['Provider', failure?.providerId ?? '—'],
    ['Model', failure?.modelId ?? '—'],
    ['Account', failure?.accountId ?? '—'],
    ['Run id', scenario.runId],
  ]
  if (scenario.subAgent !== undefined) rows.push(['Agent', scenario.subAgent.name])
  return rows
}

export function VariantC({ scenario, status, onAction, onDismiss }: FailureCardProps) {
  const [open, setOpen] = useState(false)
  const actions = actionsOf({ scenario, status })
  const [primary, ...rest] = actions
  const handleToggle = () => setOpen((value) => !value)
  const handleOpenAgent = () => onAction(EFailureAction.OpenAgent)
  return (
    <section aria-label="Run failure" className="flex flex-col text-sm">
      <div className="flex items-center gap-2 rounded-md py-1 pr-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={handleToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="truncate text-destructive">{scenario.title}</span>
          <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
            {metaOf(scenario)}
          </span>
        </button>
        {primary === undefined ? null : (
          <ActionButton action={primary} status={status} onAction={onAction} short />
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
          <XIcon />
        </Button>
      </div>
      {open ? (
        <div className="ml-[7px] flex flex-col gap-3 border-l border-destructive/40 py-2 pl-4">
          <p className="text-muted-foreground">{scenario.detail}</p>
          {scenario.failure === undefined ? null : (
            <p className="font-mono text-xs text-muted-foreground">“{scenario.failure.message}”</p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
            {detailRows(scenario).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {rest.map((action) => (
              <ActionButton
                key={action.kind}
                action={action}
                status={status}
                onAction={onAction}
                short
              />
            ))}
            {scenario.subAgent === undefined ? null : (
              <Button size="sm" variant="ghost" onClick={handleOpenAgent}>
                View agent
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
