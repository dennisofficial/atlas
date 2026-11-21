import {
  toolTakesClause,
  type CallId,
  type EventDraft,
  type ToolParameters,
} from '@dltech/atlas-core'

import { logFieldsOf } from '@dltech/atlas-observability'

import type { DispatchableCall } from './dispatch'
import type { LogPort } from '@dltech/atlas-observability'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const SANDBOX_UNAVAILABLE_NAME = 'SandboxUnavailableError'

const isSandboxUnavailable = (error: unknown): boolean =>
  error instanceof Error && error.name === SANDBOX_UNAVAILABLE_NAME

const MAX_REPORTED_ISSUES = 3

export async function markDispatchStarted(args: {
  onDispatchStarted: ((draft: EventDraft) => Promise<void>) | undefined
  call: DispatchableCall
  logPort: LogPort | undefined
}): Promise<string | undefined> {
  if (args.onDispatchStarted === undefined) return undefined
  try {
    await args.onDispatchStarted({
      type: 'tool-dispatched',
      callId: args.call.callId,
      name: args.call.name,
    })
    return undefined
  } catch (error) {
    const message = messageOf(error)
    args.logPort?.error({
      source: 'tools.dispatch',
      message: `the dispatch marker for ${args.call.name} did not persist, so the call was not run`,
      threadId: args.call.threadId,
      data: { tool: args.call.name },
      ...logFieldsOf({ error }),
    })
    if (isSandboxUnavailable(error)) return message
    return `the dispatch marker for ${args.call.name} did not persist, so the call was not run: ${message}`
  }
}

export const detachedDispatchDraft = (call: { callId: CallId; name: string }): EventDraft => ({
  type: 'tool-dispatched',
  callId: call.callId,
  name: call.name,
  detached: true,
})

export function unknownToolDraft(args: {
  call: DispatchableCall
  available: readonly string[]
}): EventDraft {
  const known = args.available.length === 0 ? 'none' : args.available.join(', ')
  return {
    type: 'tool-result',
    callId: args.call.callId,
    name: args.call.name,
    output: undefined,
    error: {
      message: `no tool named "${args.call.name}" is registered; available tools: ${known}`,
    },
  }
}

export function invalidInputDraft(args: {
  call: DispatchableCall
  toolName: string
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
  parameters: ToolParameters
}): EventDraft {
  const problems = args.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => {
      const field = issue.path.map(String).join('.')
      return field === '' ? issue.message : `${field}: ${issue.message}`
    })
    .join('; ')

  return {
    type: 'tool-result',
    callId: args.call.callId,
    name: args.call.name,
    output: undefined,
    error: {
      message: [
        `the ${args.toolName} tool rejected this input: ${problems === '' ? 'it does not match the schema' : problems}.`,
        'Nothing ran.',
        toolTakesClause({ name: args.toolName, parameters: args.parameters }),
        `Call ${args.toolName} again with the required fields set.`,
      ]
        .filter((part) => part !== '')
        .join(' '),
    },
  }
}

export function markerFailureDraft(args: {
  callId: CallId
  name: string
  failure: string
}): EventDraft {
  return {
    type: 'tool-result',
    callId: args.callId,
    name: args.name,
    error: { message: args.failure },
  }
}
