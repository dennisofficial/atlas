import { CircleCheckIcon, LoaderCircleIcon } from 'lucide-react'

import { Trace } from '#components/trace'
import { Step, StepLine } from './internal/step'

export interface ReasoningProps {
  text: string
  live?: boolean
  duration?: string
  defaultOpen?: boolean
}

export function Reasoning({ text, live = false, duration, defaultOpen }: ReasoningProps) {
  if (live) return <LiveReasoning text={text} />

  return (
    <Trace>
      <Step
        icon={<CircleCheckIcon />}
        title="Thought"
        description={duration}
        defaultOpen={defaultOpen}
        contentClassName="whitespace-pre-wrap"
      >
        {text.length > 0 ? text : undefined}
      </Step>
    </Trace>
  )
}

function LiveReasoning({ text }: { text: string }) {
  return (
    <Trace>
      <StepLine
        icon={<LoaderCircleIcon className="animate-spin" />}
        title="Thinking"
        status="running"
      />
      {text.length > 0 ? (
        <div
          data-slot="reasoning-tail"
          className="mb-1 ml-[calc(--spacing(2)-1px)] flex max-h-[4lh] min-w-0 flex-col justify-end overflow-hidden border-l pr-1 pl-4 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-muted-foreground mask-t-from-[calc(100%-1lh)]"
        >
          <p>{text}</p>
        </div>
      ) : null}
    </Trace>
  )
}
