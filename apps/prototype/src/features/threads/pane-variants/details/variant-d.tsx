import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  CircleIcon,
  FileTextIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ETodoStatus, todoLabelOf } from '../../details/details-model'
import { EPrState, PR_STATE_LABEL } from '../../pull-request-model'
import {
  EServiceState,
  PANE_CONTEXT,
  PANE_CREW,
  PANE_PRS,
  PANE_SERVICES,
  PLAN_TASKS,
} from './details-data'
import {
  ciLabelOf,
  contextSizeOf,
  prDiffOf,
  reviewNoteOf,
  SESSION_ELAPSED,
  SESSION_STATUS,
  SESSION_TITLE,
} from './variant-d-data'
import { FoldedRows, Row, SectionHead } from './variant-d-parts'

const TODO_GLYPH: Record<ETodoStatus, ReactNode> = {
  [ETodoStatus.Done]: (
    <span className="flex size-3.5 items-center justify-center rounded-full bg-success text-background">
      <CheckIcon aria-hidden className="size-2.5" strokeWidth={3} />
    </span>
  ),
  [ETodoStatus.Running]: (
    <CircleIcon aria-hidden className="size-3.5 text-primary" strokeWidth={2.5} />
  ),
  [ETodoStatus.Pending]: (
    <CircleDashedIcon aria-hidden className="size-3.5 text-muted-foreground/50" />
  ),
}

const PR_TONE: Record<EPrState, string> = {
  [EPrState.Open]: 'bg-pr-open/10 text-pr-open',
  [EPrState.Merged]: 'bg-pr-merged/12 text-pr-merged',
  [EPrState.Draft]: 'bg-muted text-muted-foreground',
  [EPrState.Closed]: 'bg-destructive/10 text-destructive',
}

const SERVICE_TONE: Record<EServiceState, string> = {
  [EServiceState.Running]: 'bg-success',
  [EServiceState.Starting]: 'bg-warning',
  [EServiceState.Stopped]: 'bg-muted-foreground/40',
  [EServiceState.Failed]: 'bg-destructive',
}

const CREW_TONE: Record<EAgentDisplay, string> = {
  [EAgentDisplay.StartingSandbox]: 'bg-muted-foreground/40',
  [EAgentDisplay.Running]: 'bg-success',
  [EAgentDisplay.NeedsApproval]: 'bg-warning',
  [EAgentDisplay.Paused]: 'bg-muted-foreground/40',
  [EAgentDisplay.WaitingForModel]: 'bg-warning',
  [EAgentDisplay.Failed]: 'bg-destructive',
  [EAgentDisplay.Done]: 'bg-muted-foreground/40',
}

const DONE_TASKS = PLAN_TASKS.filter((task) => task.status === ETodoStatus.Done).length

export function VariantD() {
  const [following, setFollowing] = useState(true)
  const [todosOpen, setTodosOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const currentTask = PLAN_TASKS.find((task) => task.status === ETodoStatus.Running)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border/60 px-4 py-2.5">
        <div className="mx-auto w-full max-w-[34rem]">
          <h2 className="truncate text-[13px] leading-5 font-medium">{SESSION_TITLE}</h2>
          <div className="flex items-center gap-2">
            <Badge className="h-[18px] gap-1 bg-success/10 px-1.5 text-[10px] font-normal text-success">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              {SESSION_STATUS}
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {SESSION_ELAPSED}
            </span>
            <label
              htmlFor="variant-d-following"
              className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground"
            >
              Following
              <Switch
                id="variant-d-following"
                size="sm"
                checked={following}
                onCheckedChange={setFollowing}
              />
            </label>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[34rem] flex-col gap-6 px-4 py-4">
          <section className="flex flex-col">
            <button
              type="button"
              aria-expanded={todosOpen}
              onClick={() => setTodosOpen((held) => !held)}
              className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left outline-none hover:[&_span]:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="text-[11px] leading-4 font-medium text-muted-foreground tabular-nums">
                {DONE_TASKS} / {PLAN_TASKS.length} tasks
              </span>
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  'size-3 shrink-0 text-muted-foreground transition-transform',
                  !todosOpen && '-rotate-90',
                )}
              />
              {todosOpen ? null : (
                <span className="min-w-0 truncate text-[13px] leading-4">
                  {currentTask === undefined ? 'All tasks done' : todoLabelOf(currentTask)}
                </span>
              )}
            </button>
            {todosOpen
              ? PLAN_TASKS.map((task) => (
                  <Row
                    key={task.id}
                    leading={TODO_GLYPH[task.status]}
                    title={
                      <span
                        className={cn(
                          task.status === ETodoStatus.Pending && 'text-muted-foreground',
                        )}
                      >
                        {todoLabelOf(task)}
                      </span>
                    }
                  />
                ))
              : null}
          </section>

          <section className="flex flex-col">
            <SectionHead title="Pull requests" count={PANE_PRS.length} />
            {PANE_PRS.map((pr) => {
              const diff = prDiffOf(pr)
              return (
                <Row
                  key={pr.number}
                  leading={null}
                  title={
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="outline-none hover:underline focus-visible:underline"
                    >
                      {pr.title}
                    </a>
                  }
                  meta={
                    <span>
                      <span className="font-mono">#{pr.number}</span> ·{' '}
                      <span className={cn('font-mono', pr.failing > 0 && 'text-destructive')}>
                        {ciLabelOf(pr)}
                      </span>{' '}
                      · {reviewNoteOf(pr)}
                    </span>
                  }
                  trailing={
                    <>
                      <Badge
                        className={cn('h-[18px] px-1.5 text-[10px] font-normal', PR_TONE[pr.state])}
                      >
                        {PR_STATE_LABEL[pr.state]}
                      </Badge>
                      <span className="flex gap-1 font-mono">
                        <span className="text-success">+{diff.added}</span>
                        <span className="text-destructive">−{diff.removed}</span>
                      </span>
                    </>
                  }
                />
              )
            })}
          </section>

          <section className="flex flex-col">
            <SectionHead title="Services" count={PANE_SERVICES.length} />
            <FoldedRows
              rows={PANE_SERVICES}
              render={(service) => (
                <Row
                  key={service.id}
                  leading={
                    <span className={cn('size-2 rounded-full', SERVICE_TONE[service.state])} />
                  }
                  title={
                    <span className="flex items-baseline gap-1">
                      {service.name}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        :{service.port ?? '—'}
                      </span>
                    </span>
                  }
                  trailing={
                    service.url === undefined ? null : (
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-0.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        open
                        <ArrowUpRightIcon aria-hidden className="size-3" />
                      </a>
                    )
                  }
                />
              )}
            />
          </section>

          <section className="flex flex-col">
            <SectionHead title="Teammates" count={PANE_CREW.length} />
            <FoldedRows
              rows={PANE_CREW}
              render={(member) => (
                <Row
                  key={member.id}
                  leading={
                    <span className={cn('size-2 rounded-full', CREW_TONE[member.display])} />
                  }
                  title={member.name}
                  meta={member.intent}
                  trailing={<span className="font-mono">{member.elapsed}</span>}
                />
              )}
            />
          </section>

          <section className="flex flex-col">
            <SectionHead
              title="Context files"
              count={PANE_CONTEXT.length}
              open={contextOpen}
              onToggle={() => setContextOpen((held) => !held)}
            />
            {contextOpen ? (
              <FoldedRows
                rows={PANE_CONTEXT}
                render={(file) => (
                  <Row
                    key={file.path}
                    leading={<FileTextIcon aria-hidden className="size-3" />}
                    title={<span className="font-mono text-[12px]">{file.path}</span>}
                    trailing={<span className="font-mono">{contextSizeOf(file.detail)}</span>}
                  />
                )}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}
