import { describe, expect, it } from 'bun:test'

import {
  CallHandedOffError,
  CallInterruptedError,
  EToolEffect,
  ToolDefinition,
  toCallId,
  toRunId,
  toThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { HandoffAborted } from '../../loop/retry-ledger'
import { invokeTool } from '../invoke-tool'

const THREAD = toThreadId('thread-1')

class ThrowingTool extends ToolDefinition {
  readonly name = 'services_start'
  readonly description = 'start a service'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(private readonly failure: unknown) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    throw this.failure
  }
}

const invoke = (failure: unknown): Promise<ToolOutcome> =>
  invokeTool({
    definition: new ThrowingTool(failure),
    call: {
      callId: toCallId('call-1'),
      name: 'services_start',
      input: {},
      effect: EToolEffect.Write,
      threadId: THREAD,
    },
    signal: new AbortController().signal,
    idempotencyKey: `${toRunId('run-1')}:call-1`,
    projectDirectory: '/repo',
    homeDirectory: undefined,
    activeWorktree: undefined,
    threadId: THREAD,
    onOutput: undefined,
    captureFileChanges: false,
    logPort: undefined,
  })

describe('invokeTool when the holder handed the record back', () => {
  it('stops the turn instead of reporting the call as failed', async () => {
    await expect(invoke(new CallHandedOffError('handed back'))).rejects.toBeInstanceOf(
      HandoffAborted,
    )
  })

  it('still reports a tool that threw for any other reason', async () => {
    const outcome = await invoke(new Error('boom'))

    expect(outcome.ok).toBe(false)
  })

  it('still rethrows a call the pod interrupted', async () => {
    await expect(
      invoke(new CallInterruptedError({ message: 'interrupted' })),
    ).rejects.toBeInstanceOf(CallInterruptedError)
  })
})
