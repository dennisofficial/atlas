'use client'

import { ChevronRightIcon, CircleCheckIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Progress } from '#components/progress'
import { StatusIcon } from './internal/step'
import { EStepStatus, countDone, type PlanStep } from './plan'

export interface DockSummary {
  done: number
  total: number
  label: string
}

const findStep = (steps: PlanStep[], status: EStepStatus): PlanStep | undefined =>
  steps.find((step) => step.status === status)

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
  return { done, total: steps.length, label: `${done} of ${steps.length} · ${dockHeadline(steps)}` }
}

export function dockStatus(steps: PlanStep[]): EStepStatus {
  if (findStep(steps, EStepStatus.Error)) return EStepStatus.Error
  if (findStep(steps, EStepStatus.Running)) return EStepStatus.Running
  if (steps.every((step) => step.status === EStepStatus.Done)) return EStepStatus.Done
  return EStepStatus.Pending
}

export interface PlanSummaryProps {
  steps: PlanStep[]
  onOpen: () => void
}

export function PlanSummary({ steps, onOpen }: PlanSummaryProps) {
  if (steps.length === 0) return null

  const { done, total, label } = dockSummary(steps)

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start font-normal"
        aria-label={`Plan: ${label}`}
        onClick={onOpen}
      >
        <StatusIcon
          status={dockStatus(steps)}
          doneIcon={<CircleCheckIcon className="text-success" />}
        />
        <span className="min-w-0 flex-1 truncate text-left tabular-nums">{label}</span>
        <ChevronRightIcon className="text-muted-foreground" />
      </Button>
      <Progress value={(done / total) * 100} aria-label="Plan progress" />
    </div>
  )
}
