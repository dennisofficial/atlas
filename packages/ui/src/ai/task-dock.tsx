'use client'

import { ChevronUpIcon, CircleCheckIcon, XIcon } from 'lucide-react'

import { Badge } from '#components/badge'
import { Button } from '#components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#components/collapsible'
import { Progress } from '#components/progress'
import { Trace } from '#components/trace'
import { cn } from '#lib/utils'
import { EStepStatus, type PlanStep, countDone } from './plan'
import { StatusIcon, StepLine, traceStatusOf } from './internal/step'

export { EStepStatus }

export interface QueuedMessage {
  id: string
  text: string
}

export interface TaskDockProps {
  steps: PlanStep[]
  queued?: QueuedMessage[]
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onRemoveQueued?: (id: string) => void
  className?: string
}

export interface DockSummary {
  done: number
  total: number
  label: string
}

function findStep(steps: PlanStep[], status: EStepStatus): PlanStep | undefined {
  return steps.find((step) => step.status === status)
}

function dockHeadline(steps: PlanStep[]): string {
  const failed = findStep(steps, EStepStatus.Error)
  if (failed) return `Failed: ${failed.title}`
  const running = findStep(steps, EStepStatus.Running)
  if (running) return running.title
  const next = findStep(steps, EStepStatus.Pending)
  if (next) return `Next: ${next.title}`
  return 'Done'
}

export function dockSummary(steps: PlanStep[]): DockSummary {
  const done = countDone(steps)
  const total = steps.length
  return { done, total, label: `${done} of ${total} · ${dockHeadline(steps)}` }
}

export function dockStatus(steps: PlanStep[]): EStepStatus {
  if (findStep(steps, EStepStatus.Error)) return EStepStatus.Error
  if (findStep(steps, EStepStatus.Running)) return EStepStatus.Running
  if (steps.every((step) => step.status === EStepStatus.Done)) {
    return EStepStatus.Done
  }
  return EStepStatus.Pending
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</p>
  )
}

function QueuedRow({
  message,
  onRemove,
}: {
  message: QueuedMessage
  onRemove?: (id: string) => void
}) {
  const handleRemove = () => onRemove?.(message.id)

  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-foreground">{message.text}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Remove queued message"
        onClick={handleRemove}
      >
        <XIcon />
      </Button>
    </li>
  )
}

function Strip({ steps, queued }: { steps: PlanStep[]; queued: QueuedMessage[] }) {
  const hasSteps = steps.length > 0
  const label = hasSteps ? dockSummary(steps).label : 'Queued messages'

  return (
    <CollapsibleTrigger
      className={cn(
        'group/dock flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm outline-none',
        'hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
      )}
    >
      {hasSteps ? (
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
          <StatusIcon
            status={dockStatus(steps)}
            doneIcon={<CircleCheckIcon className="text-success" />}
          />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-foreground tabular-nums">{label}</span>
      {hasSteps && queued.length > 0 ? (
        <Badge variant="secondary">{queued.length} queued</Badge>
      ) : null}
      <ChevronUpIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/dock:rotate-180" />
    </CollapsibleTrigger>
  )
}

function DockBody({
  steps,
  queued,
  onRemoveQueued,
}: {
  steps: PlanStep[]
  queued: QueuedMessage[]
  onRemoveQueued?: (id: string) => void
}) {
  return (
    <div className="flex max-h-96 flex-col gap-3 overflow-auto border-b border-border px-3 py-3">
      {steps.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Plan</SectionLabel>
          <Trace>
            {steps.map((step) => (
              <StepLine
                key={step.id}
                icon={<StatusIcon status={step.status} />}
                title={step.title}
                status={traceStatusOf(step.status)}
              />
            ))}
          </Trace>
        </section>
      ) : null}
      {queued.length > 0 ? (
        <section className="flex flex-col gap-1">
          <SectionLabel>Queued</SectionLabel>
          <ul className="flex flex-col gap-0.5">
            {queued.map((message) => (
              <QueuedRow key={message.id} message={message} onRemove={onRemoveQueued} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export function TaskDock({
  steps,
  queued = [],
  open,
  defaultOpen,
  onOpenChange,
  onRemoveQueued,
  className,
}: TaskDockProps) {
  if (steps.length === 0 && queued.length === 0) return null

  const { done, total } = dockSummary(steps)

  return (
    <Collapsible
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      className={cn(
        'flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card',
        className,
      )}
    >
      <CollapsibleContent>
        <DockBody steps={steps} queued={queued} onRemoveQueued={onRemoveQueued} />
      </CollapsibleContent>
      <Strip steps={steps} queued={queued} />
      {total > 0 ? <Progress value={(done / total) * 100} aria-label="Plan progress" /> : null}
    </Collapsible>
  )
}
