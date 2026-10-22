import type { ReactNode } from 'react'
import { LoaderCircleIcon } from 'lucide-react'

import { Trace } from '#components/trace'
import { Step } from './internal/step'

export interface WorkSummaryProps {
  duration: string
  running?: boolean
  stepCount?: number
  defaultOpen?: boolean
  children: ReactNode
}

interface TitleInput {
  duration: string
  running: boolean
}

export function workSummaryTitle({ duration, running }: TitleInput): string {
  return running ? `Working for ${duration}` : `Worked for ${duration}`
}

function stepCountLabel(stepCount: number | undefined): string | undefined {
  if (stepCount === undefined) return undefined
  return stepCount === 1 ? '1 step' : `${stepCount} steps`
}

export function WorkSummary({
  duration,
  running = false,
  stepCount,
  defaultOpen,
  children,
}: WorkSummaryProps) {
  return (
    <Trace>
      <Step
        icon={running ? <LoaderCircleIcon className="animate-spin" /> : undefined}
        title={workSummaryTitle({ duration, running })}
        description={stepCountLabel(stepCount)}
        status={running ? 'running' : undefined}
        autoOpen={defaultOpen === undefined ? running : undefined}
        defaultOpen={defaultOpen}
        contentClassName="flex flex-col gap-2"
      >
        {children}
      </Step>
    </Trace>
  )
}
