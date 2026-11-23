import { describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  EStage,
  EToolEffect,
  ToolDefinition,
  toCallId,
  toRunId,
  toThreadId,
  type BeforeToolOutcome,
  type ToolCall,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { HookChain } from '../../hooks/registry'
import { fakeToolRegistry } from '../../testing'
import { HookedToolDispatcher, type DispatchArgs } from '../dispatch'
import { filteredToolRegistry } from '../registry'

class DeferredTool extends ToolDefinition {
  readonly description = 'search meetings'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.object({ query: z.string() })
  readonly deferred = true
  readonly inputs: unknown[] = []

  constructor(readonly name: string) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    this.inputs.push(args.input)
    return { ok: true, output: 'one meeting', modelText: 'one meeting' }
  }
}

class RoutineLikeTool extends ToolDefinition {
  readonly name = 'routine'
  readonly description = 'manage routines'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.strictObject({
    action: z.enum(['update']),
    routineId: z.string(),
    enabled: z.boolean().optional(),
    model: z.string().min(1).nullable().optional(),
    fast: z.boolean().nullable().optional(),
  })
  readonly deferred = true
  readonly inputs: unknown[] = []

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    this.inputs.push(args.input)
    return { ok: true, output: 'paused', modelText: 'paused' }
  }
}

const THREAD = toThreadId('thread-1')
const RUN = toRunId('run-1')
const CALL = toCallId('call-1')

const argsOf = (input: unknown, name = 'mcp__meetings__search'): DispatchArgs => ({
  call: { callId: CALL, name, input, runId: RUN, threadId: THREAD },
  signal: new AbortController().signal,
  projectDirectory: '/w',
  events: [],
})

const recorder = (seen: ToolCall[]) => ({
  name: 'record-calls',
  order: { stage: EStage.Guard, nudge: 0 },
  run: async ({ call }: { call: ToolCall }): Promise<BeforeToolOutcome> => {
    seen.push(call)
    return { decision: EBeforeToolDecision.Allow, input: call.input }
  },
})

const denier = {
  name: 'deny-meetings',
  order: { stage: EStage.Guard, nudge: 0 },
  run: async (): Promise<BeforeToolOutcome> => ({
    decision: EBeforeToolDecision.Deny,
    reason: 'no meeting tools here',
  }),
}

describe('a direct call to a deferred tool', () => {
  it('runs the real tool, and the hooks see its real name and input', async () => {
    const target = new DeferredTool('mcp__meetings__search')
    const seen: ToolCall[] = []
    const dispatcher = new HookedToolDispatcher({
      registry: fakeToolRegistry([target]),
      hooks: new HookChain({ beforeTool: [recorder(seen)] }),
    })

    const drafts = await dispatcher.dispatch(argsOf({ query: 'weekly' }))

    expect(target.inputs).toEqual([{ query: 'weekly' }])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.name).toBe(target.name)
    expect(seen[0]?.input).toEqual({ query: 'weekly' })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      type: 'tool-result',
      name: target.name,
      callId: CALL,
      modelText: 'one meeting',
    })
  })

  it('lets a deny hook stop it, under its real name', async () => {
    const target = new DeferredTool('mcp__meetings__search')
    const dispatcher = new HookedToolDispatcher({
      registry: fakeToolRegistry([target]),
      hooks: new HookChain({ beforeTool: [denier] }),
    })

    const drafts = await dispatcher.dispatch(argsOf({ query: 'weekly' }))

    expect(target.inputs).toEqual([])
    expect(drafts).toContainEqual({
      type: 'tool-denied',
      callId: CALL,
      name: target.name,
      reason: 'no meeting tools here',
    })
  })

  it('refuses a target the filtered registry denies', async () => {
    const target = new DeferredTool('mcp__meetings__search')
    const dispatcher = new HookedToolDispatcher({
      registry: filteredToolRegistry({
        registry: fakeToolRegistry([target]),
        deny: [target.name],
      }),
      hooks: new HookChain({}),
    })

    const drafts = await dispatcher.dispatch(argsOf({ query: 'weekly' }))

    expect(target.inputs).toEqual([])
    expect(drafts[0]).toMatchObject({ type: 'tool-result', name: target.name })
    const error = drafts[0]?.type === 'tool-result' ? drafts[0].error?.message : undefined
    expect(error).toContain(target.name)
  })
})

describe('the input of a deferred tool', () => {
  const update = { action: 'update', routineId: 'r-1', enabled: false, fast: null, model: null }

  it('reaches the tool typed when the provider sent its scalars as strings', async () => {
    const target = new RoutineLikeTool()
    const dispatcher = new HookedToolDispatcher({
      registry: fakeToolRegistry([target]),
      hooks: new HookChain({}),
    })

    const drafts = await dispatcher.dispatch(
      argsOf(
        { action: 'update', routineId: 'r-1', enabled: 'false', fast: 'null', model: 'null' },
        target.name,
      ),
    )

    expect(drafts[0]).toMatchObject({ type: 'tool-result', name: target.name, modelText: 'paused' })
    expect(target.inputs).toEqual([update])
  })

  it('reaches the tool unchanged when it was already typed', async () => {
    const target = new RoutineLikeTool()
    const dispatcher = new HookedToolDispatcher({
      registry: fakeToolRegistry([target]),
      hooks: new HookChain({}),
    })

    await dispatcher.dispatch(argsOf(update, target.name))

    expect(target.inputs).toEqual([update])
  })
})
