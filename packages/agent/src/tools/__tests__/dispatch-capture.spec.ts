import { describe, expect, it } from 'bun:test'

import {
  EStage,
  EToolEffect,
  ToolDefinition,
  toCallId,
  toRunId,
  toThreadId,
  type EventDraft,
  type HookOutcome,
  type ToolCall,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { HookChain, type AfterToolHook } from '../../hooks/registry'
import { HookedToolDispatcher } from '../dispatch'
import { InMemoryToolRegistry } from '../registry'

const THREAD = toThreadId('thread-1')
const CALL = toCallId('call-1')
const RUN = toRunId('run-1')

const dispatchArgs = {
  call: {
    callId: CALL,
    name: 'write',
    input: { path: '/repo/a.ts' },
    runId: RUN,
    threadId: THREAD,
  },
  signal: new AbortController().signal,
  projectDirectory: '/repo',
  events: [],
}

const change = { path: '/repo/a.ts', before: null, after: 'export const a = 1\n' }

class WriteTool extends ToolDefinition {
  readonly name = 'write'
  readonly description = 'write a file'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({ path: z.string() })
  readonly invocations: ToolInvocation[] = []

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    this.invocations.push(args)
    return { ok: true, output: {}, modelText: 'wrote', fileChanges: [change] }
  }
}

const hookThat = (args: {
  name?: string
  captures?: (args: { call: ToolCall; signal: AbortSignal }) => Promise<boolean>
  run?: (args: { call: ToolCall; result: ToolOutcome }) => Promise<HookOutcome>
}): AfterToolHook => ({
  name: args.name ?? 'reviewer',
  order: { stage: EStage.Observe, nudge: 0 },
  run: async ({ call, result }) => (args.run === undefined ? {} : args.run({ call, result })),
  ...(args.captures === undefined ? {} : { capturesFileChanges: args.captures }),
})

const dispatchOver = (args: { tool: WriteTool; hooks: readonly AfterToolHook[] }) =>
  new HookedToolDispatcher({
    registry: new InMemoryToolRegistry([args.tool]),
    hooks: new HookChain({ afterTool: args.hooks }),
  }).dispatch(dispatchArgs)

describe('a dispatcher with an afterTool hook that captures file changes', () => {
  it('asks the tool to capture, then hands the captured changes to the hook', async () => {
    const tool = new WriteTool()
    const seen: ToolOutcome[] = []

    const drafts = await dispatchOver({
      tool,
      hooks: [
        hookThat({
          captures: async ({ call }) => call.name === 'write',
          run: async ({ result }) => {
            seen.push(result)
            return {}
          },
        }),
      ],
    })

    expect(tool.invocations[0]?.captureFileChanges).toBe(true)
    expect(seen).toEqual([{ ok: true, output: {}, modelText: 'wrote', fileChanges: [change] }])
    expect(drafts.map((draft) => draft.type)).toEqual(['tool-result'])
  })

  it('asks for no captured text when no hook opts in', async () => {
    const tool = new WriteTool()

    await dispatchOver({ tool, hooks: [hookThat({ run: async () => ({}) })] })

    expect('captureFileChanges' in (tool.invocations[0] ?? {})).toBe(false)
  })

  it('records a keyed context event after the tool result, under the call it names', async () => {
    const tool = new WriteTool()

    const drafts = await dispatchOver({
      tool,
      hooks: [
        hookThat({
          run: async ({ call }) => ({ additionalContext: 'finding A', contextKey: call.callId }),
        }),
      ],
    })

    expect(drafts).toEqual([
      { type: 'tool-result', callId: CALL, name: 'write', output: {}, modelText: 'wrote' },
      { type: 'context-loaded', slot: 'reviewer', key: CALL, content: 'finding A' },
    ] satisfies EventDraft[])
  })
})
