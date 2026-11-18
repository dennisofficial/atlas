import { CircleCheckIcon, CircleIcon, FileTextIcon, LoaderCircleIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { AgentStatusIcon, agentDisplayLabel } from '@dltech/atlas-ui/ai/agent-status'
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
  planCountLabel,
  prChecksLabelOf,
  SERVICE_STATE_LABEL,
} from './details-data'

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

function Block(props: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border/50 pb-2 last:border-b-0">
      <header className="flex h-8 items-center justify-between gap-3 px-3">
        <h3 className="text-[13px] font-medium">{props.title}</h3>
        {props.meta === undefined ? null : (
          <span className="truncate text-xs text-muted-foreground tabular-nums">{props.meta}</span>
        )}
      </header>
      <div>{props.children}</div>
    </section>
  )
}

function Row(props: {
  icon: ReactNode
  label: string
  detail?: string
  meta?: ReactNode
  muted?: boolean
}) {
  return (
    <div className="grid h-10 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2.5 px-3">
      <span className="flex size-4 items-center justify-center text-muted-foreground">
        {props.icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'truncate text-[13px] leading-4',
            props.muted === true && 'text-muted-foreground',
          )}
        >
          {props.label}
        </span>
        {props.detail === undefined ? null : (
          <span className="truncate text-xs leading-4 text-muted-foreground">{props.detail}</span>
        )}
      </span>
      {props.meta === undefined ? null : (
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {props.meta}
        </span>
      )}
    </div>
  )
}

function ServiceDot({ state }: { state: EServiceState }) {
  return (
    <span className="flex size-4 items-center justify-center">
      <span className={cn('size-2 rounded-full', SERVICE_TONE[state])} />
    </span>
  )
}

function Bell({ watched }: { watched: boolean }) {
  return (
    <span
      className={cn(
        'flex size-5 items-center justify-center rounded-full border',
        watched
          ? 'border-border bg-muted text-foreground'
          : 'border-transparent text-muted-foreground/50',
      )}
    >
      <span className="sr-only">{watched ? 'Watching' : 'Not watching'}</span>
      <span aria-hidden className="text-[10px] leading-none">
        {watched ? '●' : '○'}
      </span>
    </span>
  )
}

export function VariantA() {
  const [watched, setWatched] = useState(() =>
    PANE_PRS.filter((pr) => pr.watched).map((pr) => pr.number),
  )
  const handleToggleWatch = (number: number) =>
    setWatched((held) =>
      held.includes(number) ? held.filter((key) => key !== number) : [...held, number],
    )

  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="py-2">
        <Block title="Todo" meta={planCountLabel(PLAN_TASKS)}>
          {PLAN_TASKS.map((task) => (
            <Row
              key={task.id}
              icon={TODO_ICON[task.status]}
              label={todoLabelOf(task)}
              muted={task.status === ETodoStatus.Done}
            />
          ))}
        </Block>

        <Block title="Pull requests" meta={<span>{PANE_BRANCH}</span>}>
          {PANE_PRS.map((pr) => (
            <Row
              key={pr.number}
              icon={<PrStateIcon state={pr.state} />}
              label={`#${pr.number} ${pr.title}`}
              detail={`${PR_STATE_LABEL[pr.state]} · ${prChecksLabelOf(pr)} · ${pr.review}`}
              meta={
                <button
                  type="button"
                  aria-label={`${watched.includes(pr.number) ? 'Unwatch' : 'Watch'} #${pr.number}`}
                  aria-pressed={watched.includes(pr.number)}
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => handleToggleWatch(pr.number)}
                >
                  <Bell watched={watched.includes(pr.number)} />
                </button>
              }
            />
          ))}
        </Block>

        <Block title="Services" meta={`${PANE_SERVICES.length} ports`}>
          {PANE_SERVICES.map((service) => (
            <Row
              key={service.id}
              icon={<ServiceDot state={service.state} />}
              label={service.name}
              detail={
                service.url === undefined
                  ? `${SERVICE_STATE_LABEL[service.state]} · port ${service.port ?? '—'}`
                  : undefined
              }
              meta={
                <span className="flex items-center gap-2">
                  {service.url === undefined ? null : (
                    <a
                      href={service.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-border underline-offset-2 hover:text-foreground"
                    >
                      {service.port}
                    </a>
                  )}
                  <span className="w-14 text-right">{service.uptime ?? '—'}</span>
                </span>
              }
            />
          ))}
        </Block>

        <Block title="Sub-agents & teammates" meta={`${PANE_CREW.length} running or settled`}>
          {PANE_CREW.map((member) => (
            <Row
              key={member.id}
              icon={<AgentStatusIcon display={member.display} />}
              label={`${member.name} · ${member.role}`}
              detail={member.intent}
              meta={
                <span className="flex items-center gap-2">
                  <span>{agentDisplayLabel(member.display)}</span>
                  <span className="w-12 text-right">{member.elapsed}</span>
                </span>
              }
            />
          ))}
        </Block>

        <Block title="Context" meta={`${PANE_CONTEXT.length} files loaded`}>
          {PANE_CONTEXT.map((file) => (
            <Row
              key={file.path}
              icon={<FileTextIcon aria-hidden className="size-3.5" />}
              label={file.path}
              detail={file.detail}
              meta={file.kind}
            />
          ))}
        </Block>
      </div>
    </div>
  )
}
