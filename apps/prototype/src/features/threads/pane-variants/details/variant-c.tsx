import {
  BellIcon,
  BellOffIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleIcon,
  FileTextIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  ServerIcon,
  UsersIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { AgentStatusIcon, agentDisplayLabel } from '@dltech/atlas-ui/ai/agent-status'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ETodoStatus, isWorking, todoLabelOf } from '../../details/details-model'
import { PR_STATE_LABEL } from '../../pull-request-model'
import { PrStateIcon } from '../../pr-parts'
import {
  EServiceState,
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

const DONE_COUNT = PLAN_TASKS.filter((task) => task.status === ETodoStatus.Done).length
const PROGRESS = Math.round((DONE_COUNT / PLAN_TASKS.length) * 100)

function Line(props: { leading?: ReactNode; children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      {props.leading === undefined ? null : (
        <span className="flex size-4 shrink-0 translate-y-0.5 items-center justify-center text-muted-foreground">
          {props.leading}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5">{props.children}</span>
      {props.trailing === undefined ? null : (
        <span className="shrink-0 text-[11px] leading-5 text-muted-foreground tabular-nums">
          {props.trailing}
        </span>
      )}
    </div>
  )
}

function Event(props: {
  time: string
  glyph: ReactNode
  title: string
  meta: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <li className="relative grid grid-cols-[2.75rem_1rem_minmax(0,1fr)] items-start gap-x-2 pb-1">
      <span className="pt-1.5 text-right text-[10px] leading-4 text-muted-foreground tabular-nums">
        {props.time}
      </span>
      <span className="relative flex h-full justify-center">
        <span
          aria-hidden
          className="absolute top-0 bottom-0 w-px bg-border"
          style={{ insetInline: '50%' }}
        />
        <span className="relative z-10 mt-1 flex size-4 items-center justify-center rounded-full border border-border bg-card">
          {props.glyph}
        </span>
      </span>
      <div className="min-w-0">
        <button
          type="button"
          onClick={props.onToggle}
          aria-expanded={props.open}
          className="flex w-full items-baseline gap-1.5 rounded-sm py-1 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {props.open ? (
            <ChevronDownIcon aria-hidden className="size-3 shrink-0 translate-y-0.5" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-3 shrink-0 translate-y-0.5" />
          )}
          <span className="truncate text-[13px] font-medium">{props.title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{props.meta}</span>
        </button>
        {props.open ? <div className="pb-2 pl-1">{props.children}</div> : null}
      </div>
    </li>
  )
}

export function VariantC() {
  const [open, setOpen] = useState<string[]>(['plan', 'prs', 'services', 'crew', 'context'])
  const [watched, setWatched] = useState<number[]>(() =>
    PANE_PRS.filter((pr) => pr.watched).map((pr) => pr.number),
  )
  const handleToggle = (id: string) =>
    setOpen((held) => (held.includes(id) ? held.filter((key) => key !== id) : [...held, id]))
  const handleToggleWatch = (number: number) =>
    setWatched((held) =>
      held.includes(number) ? held.filter((key) => key !== number) : [...held, number],
    )

  const runningServices = PANE_SERVICES.filter(
    (service) => service.state === EServiceState.Running,
  ).length
  const workingCrew = PANE_CREW.filter((member) => isWorking(member.display)).length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="text-xs text-muted-foreground">Thread activity</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
          live
        </span>
      </div>
      <ol className="min-h-0 flex-1 overflow-auto px-3 pt-3">
        <Event
          time="now"
          glyph={<CircleCheckIcon aria-hidden className="size-2.5 text-success" />}
          title="Plan"
          meta={planCountLabel(PLAN_TASKS)}
          open={open.includes('plan')}
          onToggle={() => handleToggle('plan')}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${PROGRESS}%` }}
              />
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">{PROGRESS}%</span>
          </div>
          {PLAN_TASKS.map((task) => (
            <Line
              key={task.id}
              leading={TODO_ICON[task.status]}
              trailing={task.status === ETodoStatus.Running ? 'working' : undefined}
            >
              <span className={cn(task.status === ETodoStatus.Done && 'text-muted-foreground')}>
                {todoLabelOf(task)}
              </span>
            </Line>
          ))}
        </Event>

        <Event
          time="2m"
          glyph={<GitPullRequestIcon aria-hidden className="size-2.5 text-primary" />}
          title="Pull requests"
          meta={`${PANE_PRS.length} · dennis/v2-pane-prototypes`}
          open={open.includes('prs')}
          onToggle={() => handleToggle('prs')}
        >
          {PANE_PRS.map((pr) => (
            <Line
              key={pr.number}
              leading={<PrStateIcon state={pr.state} />}
              trailing={
                <button
                  type="button"
                  aria-label={`${watched.includes(pr.number) ? 'Unwatch' : 'Watch'} #${pr.number}`}
                  aria-pressed={watched.includes(pr.number)}
                  className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => handleToggleWatch(pr.number)}
                >
                  {watched.includes(pr.number) ? (
                    <BellIcon aria-hidden className="size-3" />
                  ) : (
                    <BellOffIcon aria-hidden className="size-3" />
                  )}
                </button>
              }
            >
              #{pr.number} {pr.title}
              <span className="block text-[11px] text-muted-foreground">
                {PR_STATE_LABEL[pr.state]} · {pr.review} ·{' '}
                <span className={cn(pr.failing > 0 && 'text-destructive')}>
                  {prChecksLabelOf(pr)}
                </span>
              </span>
            </Line>
          ))}
        </Event>

        <Event
          time="1h"
          glyph={<ServerIcon aria-hidden className="size-2.5 text-muted-foreground" />}
          title="Services"
          meta={`${runningServices}/${PANE_SERVICES.length} up`}
          open={open.includes('services')}
          onToggle={() => handleToggle('services')}
        >
          {PANE_SERVICES.map((service) => (
            <Line
              key={service.id}
              leading={<span className={cn('size-2 rounded-full', SERVICE_TONE[service.state])} />}
              trailing={service.uptime ?? SERVICE_STATE_LABEL[service.state]}
            >
              <span className="text-[13px]">{service.name}</span>
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                {service.url ?? 'no preview'}
              </span>
            </Line>
          ))}
        </Event>

        <Event
          time="1h 20m"
          glyph={<UsersIcon aria-hidden className="size-2.5 text-muted-foreground" />}
          title="Crew"
          meta={`${workingCrew} working · ${PANE_CREW.length} spawned`}
          open={open.includes('crew')}
          onToggle={() => handleToggle('crew')}
        >
          {PANE_CREW.map((member) => (
            <Line
              key={member.id}
              leading={<AgentStatusIcon display={member.display} />}
              trailing={`${agentDisplayLabel(member.display)} · ${member.elapsed}`}
            >
              <span>
                {member.name}
                <span className="text-[11px] text-muted-foreground"> · {member.role}</span>
              </span>
              <span className="block text-[11px] text-muted-foreground">{member.intent}</span>
            </Line>
          ))}
        </Event>

        <Event
          time="3h"
          glyph={<FileTextIcon aria-hidden className="size-2.5 text-muted-foreground" />}
          title="Context loaded"
          meta={`${PANE_CONTEXT.length} files`}
          open={open.includes('context')}
          onToggle={() => handleToggle('context')}
        >
          {PANE_CONTEXT.map((file) => (
            <Line
              key={file.path}
              leading={<FileTextIcon aria-hidden className="size-3" />}
              trailing={file.kind}
            >
              {file.path}
              <span className="ml-1.5 text-[11px] text-muted-foreground">{file.detail}</span>
            </Line>
          ))}
        </Event>
      </ol>
    </div>
  )
}
