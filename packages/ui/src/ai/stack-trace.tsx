import { CircleXIcon, FileCodeIcon, LayersIcon } from 'lucide-react'

import { Trace } from '#components/trace'
import { cn } from '#lib/utils'
import { Step, StepLine } from './internal/step'

export interface StackFrame {
  line: string
  name?: string
  file?: string
  lineNumber?: string
  internal: boolean
}

export interface StackTraceProps {
  stack: string
  buildFrameHref?: (frame: StackFrame) => string
  defaultOpen?: boolean
}

const FRAME_PATTERN = /^at (.+) \((.+):(\d+):(\d+)\)$/

export function parseFrame(line: string): StackFrame {
  const match = FRAME_PATTERN.exec(line)
  return {
    line,
    name: match?.[1],
    file: match?.[2],
    lineNumber: match?.[3],
    internal: line.includes('node_modules'),
  }
}

export function parseStack(stack: string): { error: string; frames: StackFrame[] } {
  const [error = '', ...lines] = stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return { error, frames: lines.map(parseFrame) }
}

function FrameLine({ frame, href }: { frame: StackFrame; href?: string }) {
  const title = frame.name ? `${frame.name} in ${frame.file}:${frame.lineNumber}` : frame.line
  const line = { icon: <FileCodeIcon />, title }
  if (!href) return <StepLine {...line} />
  return (
    <a href={href}>
      <StepLine {...line} />
    </a>
  )
}

export function StackTrace({ stack, buildFrameHref, defaultOpen }: StackTraceProps) {
  const { error, frames } = parseStack(stack)
  const appFrames = frames.filter((frame) => !frame.internal)
  const internalFrames = frames.filter((frame) => frame.internal)

  return (
    <Trace>
      <Step
        icon={<CircleXIcon />}
        title={`Failed: ${error}`}
        status="error"
        defaultOpen={defaultOpen}
        keepMounted
        contentClassName="flex flex-col gap-2"
      >
        <p className="font-mono text-xs break-words text-destructive">{error}</p>
        <Trace>
          {appFrames.map((frame) => (
            <FrameLine key={frame.line} frame={frame} href={buildFrameHref?.(frame)} />
          ))}
          {internalFrames.length > 0 ? (
            <Step icon={<LayersIcon />} title={`${internalFrames.length} framework frames`}>
              <ol
                className={cn(
                  'flex flex-col gap-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs',
                )}
              >
                {internalFrames.map((frame) => (
                  <li key={frame.line} className="whitespace-nowrap">
                    {frame.line}
                  </li>
                ))}
              </ol>
            </Step>
          ) : null}
        </Trace>
      </Step>
    </Trace>
  )
}
