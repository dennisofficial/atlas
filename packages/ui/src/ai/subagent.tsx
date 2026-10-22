import type { ReactNode } from 'react'
import { CircleCheckIcon, LoaderCircleIcon } from 'lucide-react'

import { Badge } from '#components/badge'
import { Trace } from '#components/trace'
import { EToolKind } from './internal/kinds'
import { Tool, EToolState, type ToolProps } from './tool'
import { Step } from './internal/step'

export { EToolKind, EToolState }

export interface SubagentProps {
  name: string
  running?: boolean
  elapsed?: string
  model?: string
  tools?: string[]
  prompt?: string
  calls?: ToolProps[]
  result?: ReactNode
  defaultOpen?: boolean
}

export function Subagent({
  name,
  running = false,
  elapsed,
  model,
  tools = [],
  prompt,
  calls = [],
  result,
  defaultOpen,
}: SubagentProps) {
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
            {calls.map((call) => (
              <Tool key={call.label} {...call} />
            ))}
          </Trace>
        ) : null}
        {result ? <div className="text-foreground">{result}</div> : null}
      </Step>
    </Trace>
  )
}
