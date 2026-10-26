import type { ToolProps } from './tool'

interface VisibleCallsInput {
  calls: ToolProps[]
  maxVisibleCalls?: number
}

export interface VisibleCalls {
  hidden: number
  visible: ToolProps[]
}

export function visibleCalls({ calls, maxVisibleCalls }: VisibleCallsInput): VisibleCalls {
  if (maxVisibleCalls === undefined || calls.length <= maxVisibleCalls) {
    return { hidden: 0, visible: calls }
  }
  const keep = Math.max(0, maxVisibleCalls)
  return { hidden: calls.length - keep, visible: keep === 0 ? [] : calls.slice(-keep) }
}

export function earlierCallsLabel(hidden: number): string {
  return `${hidden} earlier tool ${hidden === 1 ? 'call' : 'calls'}`
}
