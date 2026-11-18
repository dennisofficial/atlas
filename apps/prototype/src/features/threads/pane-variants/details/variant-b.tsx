import {
  BellIcon,
  BellOffIcon,
  ChevronRightIcon,
  FileTextIcon,
  PlayIcon,
  SquareIcon,
} from 'lucide-react'
import { useState } from 'react'

import { AgentStatusIcon, agentDisplayLabel, EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Card } from '@dltech/atlas-ui/components/card'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ETodoStatus, isWorking } from '../../details/details-model'
import { EPrState, PR_STATE_LABEL } from '../../pull-request-model'
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
import { type BFocus, VariantBDrill } from './variant-b-drill'

const SERVICE_TONE: Record<EServiceState, string> = {
  [EServiceState.Running]: 'bg-success',
  [EServiceState.Starting]: 'bg-warning',
  [EServiceState.Stopped]: 'bg-muted-foreground/40',
  [EServiceState.Failed]: 'bg-destructive',
}

const KIND_TONE = {
  Instructions: 'text-primary',
  Memory: 'text-warning',
  Plan: 'text-foreground',
  Section: 'text-muted-foreground',
} as const

function Tile(props: {
  label: string
  value: string
  hint: string
  tone?: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="group/tile flex flex-col items-start gap-1 rounded-lg border border-border/60 bg-background/40 p-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="flex w-full items-center justify-between text-[11px] tracking-wide text-muted-foreground uppercase">
        {props.label}
        <ChevronRightIcon
          aria-hidden
          className="size-3 opacity-0 transition-opacity group-hover/tile:opacity-100"
        />
      </span>
      <span className={cn('text-xl leading-6 font-medium tabular-nums', props.tone)}>
        {props.value}
      </span>
      <span className="truncate text-xs text-muted-foreground">{props.hint}</span>
    </button>
  )
}

function SectionLabel(props: { children: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {props.children}
      </h3>
      {props.meta === undefined ? null : (
        <span className="text-xs text-muted-foreground tabular-nums">{props.meta}</span>
      )}
    </div>
  )
}

export function VariantB() {
  const [focus, setFocus] = useState<BFocus>()
  const [watched, setWatched] = useState<number[]>(() =>
    PANE_PRS.filter((pr) => pr.watched).map((pr) => pr.number),
  )
  const [stopped, setStopped] = useState<string[]>([])

  if (focus !== undefined) return <VariantBDrill focus={focus} onBack={() => setFocus(undefined)} />

  const handleToggleWatch = (number: number) =>
    setWatched((held) =>
      held.includes(number) ? held.filter((key) => key !== number) : [...held, number],
    )
  const handleToggleService = (id: string) =>
    setStopped((held) => (held.includes(id) ? held.filter((key) => key !== id) : [...held, id]))

  const runningServices = PANE_SERVICES.filter(
    (service) => service.state === EServiceState.Running && !stopped.includes(service.id),
  ).length
  const workingCrew = PANE_CREW.filter((member) => isWorking(member.display)).length
  const openPrs = PANE_PRS.filter((pr) => pr.state !== EPrState.Merged).length
  const failing = PANE_PRS.filter((pr) => pr.failing > 0).length
  const done = PLAN_TASKS.filter((task) => task.status === ETodoStatus.Done).length
  const running = PLAN_TASKS.find((task) => task.status === ETodoStatus.Running)

  return (
    <div className="grid h-full min-h-0 grid-cols-2 content-start gap-2 overflow-auto p-3">
      <Tile
        label="Plan"
        value={planCountLabel(PLAN_TASKS)}
        hint={running === undefined ? 'Nothing in flight' : (running.activeForm ?? running.text)}
        tone={done === PLAN_TASKS.length ? 'text-success' : undefined}
        onOpen={() => setFocus('plan')}
      />
      <Tile
        label="Pull requests"
        value={`${openPrs} open`}
        hint={failing > 0 ? `${failing} with failing checks` : 'All checks green'}
        tone={failing > 0 ? 'text-destructive' : undefined}
        onOpen={() => setFocus('prs')}
      />
      <Tile
        label="Services"
        value={`${runningServices}/${PANE_SERVICES.length}`}
        hint={
          PANE_SERVICES.some((service) => service.state === EServiceState.Failed)
            ? 'docs failed to start'
            : 'All ports answering'
        }
        onOpen={() => setFocus('services')}
      />
      <Tile
        label="Crew"
        value={`${workingCrew} working`}
        hint={`${PANE_CREW.length} spawned in this thread`}
        onOpen={() => setFocus('crew')}
      />

      <div className="col-span-2 mt-2 flex flex-col gap-2">
        <SectionLabel meta="branch dennis/v2-pane-prototypes">Pull requests</SectionLabel>
        {PANE_PRS.map((pr) => (
          <Card key={pr.number} className="gap-0 rounded-lg border-border/60 py-2.5">
            <div className="flex items-start gap-2.5 px-3">
              <PrStateIcon state={pr.state} className="mt-0.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  #{pr.number} {pr.title}
                </a>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={pr.failing > 0 ? 'destructive' : 'secondary'}
                    className="font-normal"
                  >
                    {prChecksLabelOf(pr)}
                  </Badge>
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {PR_STATE_LABEL[pr.state]}
                  </Badge>
                  <span className="truncate text-xs text-muted-foreground">{pr.review}</span>
                </div>
              </div>
              <Button
                variant={watched.includes(pr.number) ? 'secondary' : 'ghost'}
                size="icon-xs"
                aria-label={`${watched.includes(pr.number) ? 'Unwatch' : 'Watch'} #${pr.number}`}
                aria-pressed={watched.includes(pr.number)}
                onClick={() => handleToggleWatch(pr.number)}
              >
                {watched.includes(pr.number) ? <BellIcon /> : <BellOffIcon />}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <div className="col-span-2 mt-2 flex flex-col gap-2">
        <SectionLabel meta={`${runningServices} up`}>Services</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {PANE_SERVICES.map((service) => {
            const held = stopped.includes(service.id)
            const live = service.state === EServiceState.Running && !held
            return (
              <div
                key={service.id}
                className="group/svc flex items-start gap-2 rounded-lg border border-border/60 bg-background/40 p-2"
              >
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    held ? SERVICE_TONE[EServiceState.Stopped] : SERVICE_TONE[service.state],
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] leading-4">{service.name}</span>
                  <span className="truncate text-[11px] leading-4 text-muted-foreground">
                    {held ? 'Stopped' : SERVICE_STATE_LABEL[service.state]}
                    {service.port === undefined ? '' : ` · :${service.port}`}
                  </span>
                  <span className="truncate text-[11px] leading-4 text-muted-foreground/80">
                    {service.url ?? 'no preview url'}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 transition-opacity group-hover/svc:opacity-100"
                  aria-label={`${live ? 'Stop' : 'Start'} ${service.name}`}
                  onClick={() => handleToggleService(service.id)}
                >
                  {live ? <SquareIcon /> : <PlayIcon />}
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="col-span-2 mt-2 flex flex-col gap-2">
        <SectionLabel meta={`${workingCrew} working`}>Sub-agents & teammates</SectionLabel>
        <div className="flex flex-col gap-1">
          {PANE_CREW.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setFocus('crew')}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <AgentStatusIcon display={member.display} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] leading-4">
                  {member.name}
                  <span className="ml-1.5 text-xs text-muted-foreground">{member.role}</span>
                </span>
                <span className="truncate text-[11px] leading-4 text-muted-foreground">
                  {member.intent}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end text-[11px] leading-4 text-muted-foreground tabular-nums">
                <span>{agentDisplayLabel(member.display)}</span>
                <span>{member.elapsed}</span>
              </span>
              {member.display === EAgentDisplay.Failed ? (
                <Badge variant="destructive" className="font-normal">
                  Failed
                </Badge>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-2 mt-2 flex flex-col gap-2">
        <SectionLabel meta={`${PANE_CONTEXT.length} loaded`}>Context</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {PANE_CONTEXT.map((file) => (
            <span
              key={file.path}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background/40 py-1 pr-2.5 pl-2 text-xs"
            >
              <FileTextIcon aria-hidden className={cn('size-3', KIND_TONE[file.kind])} />
              <span className="truncate">{file.path}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{file.kind}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
