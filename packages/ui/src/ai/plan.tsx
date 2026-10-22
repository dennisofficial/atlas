import { CircleCheckIcon, CircleDotIcon, CircleIcon, CircleXIcon, RouteIcon } from 'lucide-react'

import { Trace } from '#components/trace'
import { EStepStatus, Step, StepLine, summarizeStatus, traceStatusOf } from './internal/step'

export { EStepStatus }

export interface PlanStep {
  id: string
  title: string
  status: EStepStatus
}

export interface PlanProps {
  title: string
  steps: PlanStep[]
  description?: string
  defaultOpen?: boolean
}

const STEP_ICON = {
  [EStepStatus.Done]: <CircleCheckIcon />,
  [EStepStatus.Running]: <CircleDotIcon />,
  [EStepStatus.Pending]: <CircleIcon />,
  [EStepStatus.Error]: <CircleXIcon />,
}

export function countDone(steps: PlanStep[]): number {
  return steps.filter((step) => step.status === EStepStatus.Done).length
}

export function Plan({ title, steps, description, defaultOpen = true }: PlanProps) {
  const unfinished = steps.some((step) => step.status !== EStepStatus.Done)
  const status = unfinished ? summarizeStatus(steps.map((step) => step.status)) : EStepStatus.Done

  return (
    <Trace>
      <Step
        icon={<RouteIcon />}
        title={title}
        description={`${countDone(steps)} of ${steps.length} done`}
        status={status === EStepStatus.Running ? 'running' : undefined}
        defaultOpen={defaultOpen}
        contentClassName="flex flex-col gap-3"
      >
        {description ? <p>{description}</p> : null}
        <Trace>
          {steps.map((step) => (
            <StepLine
              key={step.id}
              icon={STEP_ICON[step.status]}
              title={step.title}
              status={traceStatusOf(step.status)}
            />
          ))}
        </Trace>
      </Step>
    </Trace>
  )
}
