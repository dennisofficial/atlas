import { describe, expect, it } from 'bun:test'

import {
  CALL_TOOL_NAME,
  EBeforeToolDecision,
  EStage,
  EToolEffect,
  TOOL_SEARCH_NAME,
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
import { FakeTool, fakeToolRegistry } from '../../testing'
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

const THREAD = toThreadId('thread-1')
const RUN = toRunId('run-1')
const CALL = toCallId('call-1')

const argsOf = (input: unknown, name = CALL_TOOL_NAME): DispatchArgs => ({
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

describe('call_tool to a deferred tool', () => {
  it('runs the real tool, and the hooks see its real name and input', async () => {
    const target = new DeferredTool('mcp__meetings__search')
    const seen: ToolCall[] = []
    const dispatcher = new HookedToolDispatcher({
      registry: fakeToolRegistry([target]),
      hooks: new HookChain({ beforeTool: [recorder(seen)] }),
    })

    const drafts = await dispatcher.dispatch(
      argsOf({ tool: target.name, args: { query: 'weekly' } }),
    )

    expect(target.inputs).toEqual([{ query: 'weekly' }])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.name).toBe(target.name)
    expect(seen[0]?.input).toEqual({ query: 'weekly' })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      type: 'tool-result',
      name: CALL_TOOL_NAME,
      callId: CALL,
      modelText: 'one meeting',
    })
  })

  it('lets a deny hook stop it, under the name the model called', async () => {
    const target = new DeferredTool('mcp__meetings__search')
    const dispatcher = new HookedToolDispatcher({
      registry: fakeToolRegistry([target]),
      hooks: new HookChain({ beforeTool: [denier] }),
    })

    const drafts = await dispatcher.dispatch(
      argsOf({ tool: target.name, args: { query: 'weekly' } }),
    )

    expect(target.inputs).toEqual([])
    expect(drafts).toContainEqual({
      type: 'tool-denied',
      callId: CALL,
      name: CALL_TOOL_NAME,
      reason: 'no meeting tools here',
    })
  })

  it('refuses a target the filtered registry denies, and names tool_search', async () => {
    const target = new DeferredTool('mcp__meetings__search')
    const dispatcher = new HookedToolDispatcher({
      registry: filteredToolRegistry({
        registry: fakeToolRegistry([target]),
        deny: [target.name],
      }),
      hooks: new HookChain({}),
    })

    const drafts = await dispatcher.dispatch(
      argsOf({ tool: target.name, args: { query: 'weekly' } }),
    )

    expect(target.inputs).toEqual([])
    expect(drafts[0]).toMatchObject({ type: 'tool-result', name: CALL_TOOL_NAME })
    const error = drafts[0]?.type === 'tool-result' ? drafts[0].error?.message : undefined
    expect(error).toContain(target.name)
    expect(error).toContain(TOOL_SEARCH_NAME)
  })

  it('refuses a tool that was never deferred', async () => {
    const dispatcher = new HookedToolDispatcher({
      registry: fakeToolRegistry([new FakeTool('read', 'x')]),
      hooks: new HookChain({}),
    })

    const drafts = await dispatcher.dispatch(argsOf({ tool: 'read', args: {} }))

    const error = drafts[0]?.type === 'tool-result' ? drafts[0].error?.message : undefined
    expect(error).toContain('"read" is not a deferred tool')
    expect(error).toContain(TOOL_SEARCH_NAME)
  })

  it('runs a direct call to a deferred tool by its real name', async () => {
    const target = new DeferredTool('mcp__meetings__search')
    const dispatcher = new HookedToolDispatcher({
      registry: fakeToolRegistry([target]),
      hooks: new HookChain({}),
    })

    const drafts = await dispatcher.dispatch(argsOf({ query: 'weekly' }, 'mcp__meetings__search'))

    expect(target.inputs).toEqual([{ query: 'weekly' }])
    const result = drafts.find((draft) => draft.type === 'tool-result')
    expect(result?.type === 'tool-result' ? result.error : 'missing').toBeUndefined()
  })
})
