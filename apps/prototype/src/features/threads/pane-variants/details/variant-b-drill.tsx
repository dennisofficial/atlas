import { ChevronLeftIcon, CircleCheckIcon, CircleIcon, LoaderCircleIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { AgentStatusIcon, agentDisplayLabel } from '@dltech/atlas-ui/ai/agent-status'
import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ETodoStatus, todoLabelOf } from '../../details/details-model'
import { PR_STATE_LABEL } from '../../pull-request-model'
import { PrStateIcon } from '../../pr-parts'
import {
  EServiceState,
  PANE_BRANCH,
  PANE_CONTEXT,
  PANE_CREW,
  PANE_PRS,
  PANE_SERVICES,
  PLAN_TASKS,
  prChecksLabelOf,
  SERVICE_STATE_LABEL,
} from './details-data'

export type BFocus = 'plan' | 'prs' | 'services' | 'crew' | 'context'

const TITLE: Record<BFocus, string> = {
  plan: 'Plan',
  prs: 'Pull requests',
  services: 'Services',
  crew: 'Sub-agents & teammates',
  context: 'Context',
}

const TODO_ICON: Record<ETodoStatus, ReactNode> = {
  [ETodoStatus.Done]: <CircleCheckIcon aria-hidden className="size-3.5 text-success" />,
  [ETodoStatus.Running]: <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />,
  [ETodoStatus.Pending]: <CircleIcon aria-hidden className="size-3.5 text-muted-foreground" />,
}

const SERVICE_TONE: Record<EServiceState, string> = {
  [EServiceState.Running]: 'bg-success',
  [EServiceState.Starting]: 'bg-warning',
  [EServiceState.Stopped]: 'bg-muted-foreground/40',
  [EServiceState.Failed]: 'bg-destructive',
}

function DrillRow(props: {
  leading: ReactNode
  primary: ReactNode
  secondary?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border/50 px-4 py-2.5 last:border-b-0">
      <span className="flex size-5 shrink-0 items-center justify-center pt-0.5 text-muted-foreground">
        {props.leading}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm">{props.primary}</span>
        {props.secondary === undefined ? null : (
          <span className="text-xs leading-4 text-muted-foreground">{props.secondary}</span>
        )}
      </span>
      {props.trailing === undefined ? null : (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {props.trailing}
        </span>
      )}
    </div>
  )
}

export function VariantBDrill(props: { focus: BFocus; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to overview" onClick={props.onBack}>
          <ChevronLeftIcon />
        </Button>
        <h2 className="text-sm font-medium">{TITLE[props.focus]}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {props.focus === 'plan'
          ? PLAN_TASKS.map((task) => (
              <DrillRow
                key={task.id}
                leading={TODO_ICON[task.status]}
                primary={todoLabelOf(task)}
                trailing={task.status === ETodoStatus.Running ? 'now' : undefined}
              />
            ))
          : null}
        {props.focus === 'prs'
          ? PANE_PRS.map((pr) => (
              <DrillRow
                key={pr.number}
                leading={<PrStateIcon state={pr.state} />}
                primary={`#${pr.number} ${pr.title}`}
                secondary={`${pr.branch} · ${PR_STATE_LABEL[pr.state]} · ${pr.review}`}
                trailing={prChecksLabelOf(pr)}
              />
            ))
          : null}
        {props.focus === 'services'
          ? PANE_SERVICES.map((service) => (
              <DrillRow
                key={service.id}
                leading={
                  <span className={cn('size-2 rounded-full', SERVICE_TONE[service.state])} />
                }
                primary={service.name}
                secondary={
                  service.url === undefined
                    ? SERVICE_STATE_LABEL[service.state]
                    : `${SERVICE_STATE_LABEL[service.state]} · ${service.url}`
                }
                trailing={service.uptime ?? `:${service.port ?? '—'}`}
              />
            ))
          : null}
        {props.focus === 'crew'
          ? PANE_CREW.map((member) => (
              <DrillRow
                key={member.id}
                leading={<AgentStatusIcon display={member.display} />}
                primary={`${member.name} · ${member.role}`}
                secondary={member.intent}
                trailing={`${agentDisplayLabel(member.display)} · ${member.elapsed}`}
              />
            ))
          : null}
        {props.focus === 'context'
          ? PANE_CONTEXT.map((file) => (
              <DrillRow
                key={file.path}
                leading={<span className="text-[10px] font-medium">{file.kind.slice(0, 1)}</span>}
                primary={file.path}
                secondary={file.detail}
                trailing={file.kind}
              />
            ))
          : null}
      </div>
      {props.focus === 'prs' ? (
        <p className="shrink-0 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
          Branch {PANE_BRANCH}
        </p>
      ) : null}
    </div>
  )
}
