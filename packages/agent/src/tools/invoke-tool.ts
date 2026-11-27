import {
  CallHandedOffError,
  CallInterruptedError,
  type ActiveWorktree,
  type OnToolOutput,
  type ThreadId,
  type ToolCall,
  type ToolDefinition,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { errorClassOf, logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { HandoffAborted } from '../loop/retry-ledger'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function invokeTool(args: {
  definition: ToolDefinition
  call: ToolCall
  signal: AbortSignal
  idempotencyKey: string
  projectDirectory: string
  homeDirectory: string | undefined
  activeWorktree: ActiveWorktree | undefined
  threadId: ThreadId
  onOutput: OnToolOutput | undefined
  captureFileChanges: boolean
  logPort: LogPort | undefined
}): Promise<ToolOutcome> {
  try {
    return await args.definition.invoke({
      input: args.call.input,
      signal: args.signal,
      idempotencyKey: args.idempotencyKey,
      projectDirectory: args.projectDirectory,
      homeDirectory: args.homeDirectory,
      activeWorktree: args.activeWorktree,
      threadId: args.threadId,
      onOutput: args.onOutput,
      ...(args.captureFileChanges ? { captureFileChanges: true } : {}),
    })
  } catch (error) {
    if (error instanceof CallInterruptedError) throw error
    if (error instanceof CallHandedOffError) throw new HandoffAborted()
    args.logPort?.error({
      source: 'tools.dispatch',
      message: `the ${args.call.name} tool threw`,
      threadId: args.threadId,
      data: { tool: args.call.name },
      ...logFieldsOf({ error }),
    })
    return {
      ok: false,
      reason: `the ${args.call.name} tool threw: ${messageOf(error)}`,
      spanDetail: { 'error.class': errorClassOf(error) },
    }
  }
}
