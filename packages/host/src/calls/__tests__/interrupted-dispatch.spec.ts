import { describe, expect, it } from 'bun:test'

import { HookChain, HookedToolDispatcher, InMemoryToolRegistry } from '@dltech/atlas-agent'
import {
  CallInterruptedError,
  EToolEffect,
  ToolDefinition,
  type CallId,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { ScopedToolDispatcher } from '../call-scope'
import { interruptedMessage, resizeInterruptedMessage } from '../errors'

class ThrowingTool extends ToolDefinition {
  readonly name = 'bash'
  readonly description = 'throws'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.unknown()

  async invoke(): Promise<never> {
    throw new CallInterruptedError({ message: 'restarted' })
  }
}

class ResizedTool extends ToolDefinition {
  readonly name = 'bash'
  readonly description = 'throws the resize message'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.unknown()

  async invoke(): Promise<never> {
    throw new CallInterruptedError({
      message: 'raw',
      modelMessage: resizeInterruptedMessage({
        reason: 'the pod is being resized to 8 vCPU / 32 GB',
      }),
    })
  }
}

describe('ScopedToolDispatcher', () => {
  it('turns a CallInterruptedError thrown by a tool into the interrupted draft', async () => {
    const scoped = new ScopedToolDispatcher({
      inner: new HookedToolDispatcher({
        registry: new InMemoryToolRegistry([new ThrowingTool()]),
        hooks: new HookChain({}),
      }),
      daemonTools: new Set(['bash']),
    })

    const drafts = await scoped.dispatch({
      call: {
        callId: 'call-1' as CallId,
        name: 'bash',
        input: {},
        runId: 'run-1' as RunId,
        threadId: 'thread-1' as ThreadId,
      },
      signal: new AbortController().signal,
      projectDirectory: '/tmp',
      events: [],
    })

    expect(drafts).toEqual([
      {
        type: 'tool-result',
        callId: 'call-1' as CallId,
        name: 'bash',
        output: undefined,
        error: { message: interruptedMessage('bash') },
        interrupted: true,
      },
    ])
  })

  it('carries the message the host chose for the interruption', async () => {
    const scoped = new ScopedToolDispatcher({
      inner: new HookedToolDispatcher({
        registry: new InMemoryToolRegistry([new ResizedTool()]),
        hooks: new HookChain({}),
      }),
      daemonTools: new Set(['bash']),
    })

    const drafts = await scoped.dispatch({
      call: {
        callId: 'call-1' as CallId,
        name: 'bash',
        input: {},
        runId: 'run-1' as RunId,
        threadId: 'thread-1' as ThreadId,
      },
      signal: new AbortController().signal,
      projectDirectory: '/tmp',
      events: [],
    })

    expect(drafts).toEqual([
      {
        type: 'tool-result',
        callId: 'call-1' as CallId,
        name: 'bash',
        output: undefined,
        error: {
          message: resizeInterruptedMessage({
            reason: 'the pod is being resized to 8 vCPU / 32 GB',
          }),
        },
        interrupted: true,
      },
    ])
  })
})
