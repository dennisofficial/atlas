import type { ReactNode } from 'react'
import { CircleCheckIcon, LoaderCircleIcon } from 'lucide-react'

import { Badge } from '#components/badge'
import { Button } from '#components/button'
import { Trace } from '#components/trace'
import { EToolKind } from './internal/kinds'
import { Tool, EToolState, type ToolProps } from './tool'
import { Step } from './internal/step'
import { earlierCallsLabel, visibleCalls } from './subagent-calls'

export { EToolKind, EToolState }

export interface SubagentProps {
  name: string
  running?: boolean
  elapsed?: string
  model?: string
  tools?: string[]
  prompt?: string
  calls?: ToolProps[]
  maxVisibleCalls?: number
  onShowAllCalls?: () => void
  result?: ReactNode
  defaultOpen?: boolean
}

interface EarlierCallsProps {
  hidden: number
  onShowAll?: () => void
}

function EarlierCalls({ hidden, onShowAll }: EarlierCallsProps) {
  const label = earlierCallsLabel(hidden)
  if (!onShowAll) return <span className="text-xs text-muted-foreground">{label}</span>
  return (
    <Button
      variant="ghost"
      size="xs"
      className="self-start text-muted-foreground"
      onClick={onShowAll}
    >
      {label}
    </Button>
  )
}

export function Subagent({
  name,
  running = false,
  elapsed,
  model,
  tools = [],
  prompt,
  calls = [],
  maxVisibleCalls,
  onShowAllCalls,
  result,
  defaultOpen,
}: SubagentProps) {
  const { hidden, visible } = visibleCalls({ calls, maxVisibleCalls })
  const firstVisible = hidden

  return (
    <Trace>
      <Step
        icon={running ? <LoaderCircleIcon className="animate-spin" /> : <CircleCheckIcon />}
        title={`${running ? 'Running' : 'Ran'} the ${name} agent`}
        description={elapsed}
        status={running ? 'running' : undefined}
        defaultOpen={defaultOpen ?? running}
        keepMounted
        contentClassName="flex flex-col gap-3"
      >
        {model || tools.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {model ? <Badge variant="secondary">{model}</Badge> : null}
            {tools.map((tool) => (
              <Badge key={tool} variant="outline" className="font-mono">
                {tool}
              </Badge>
            ))}
          </div>
        ) : null}
        {prompt ? <p>{prompt}</p> : null}
        {calls.length > 0 ? (
          <Trace>
            {hidden > 0 ? <EarlierCalls hidden={hidden} onShowAll={onShowAllCalls} /> : null}
            {visible.map((call, index) => (
              <Tool key={`${firstVisible + index}-${call.label}`} {...call} />
            ))}
          </Trace>
        ) : null}
        {result ? <div className="text-foreground">{result}</div> : null}
      </Step>
    </Trace>
  )
}
