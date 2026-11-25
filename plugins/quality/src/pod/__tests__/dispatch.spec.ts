import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  ToolDefinition,
  messagesFromEvents,
  toRunId,
  type EventDraft,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { HookChain, HookedToolDispatcher } from '@dltech/atlas-agent'
import { InMemoryToolRegistry } from '@dltech/atlas-agent'
import { z } from 'zod'

import { CALL, PROJECT, THREAD, change, createRig, historyOf, wroteWithChanges } from './support'

const RUN = toRunId('run-1')

const dispatchArgs = {
  call: { callId: CALL, name: 'write', input: { path: change.path }, runId: RUN, threadId: THREAD },
  signal: new AbortController().signal,
  projectDirectory: PROJECT,
  events: [],
}

class WriteTool extends ToolDefinition {
  readonly name = 'write'
  readonly description = 'write a file'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({ path: z.string() })
  readonly invocations: ToolInvocation[] = []

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    this.invocations.push(args)
    return wroteWithChanges()
  }
}

const textOf = (drafts: readonly EventDraft[]): string =>
  drafts.flatMap((draft) => (draft.type === 'context-loaded' ? [draft.content] : [])).join('\n')

describe('the quality hook through the dispatcher', () => {
  it('asks the tool to capture, then logs the record and the keyed finding', async () => {
    const rig = createRig()
    const tool = new WriteTool()

    const drafts = await new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([tool]),
      hooks: new HookChain({ afterTool: [rig.hook] }),
    }).dispatch(dispatchArgs)

    expect(tool.invocations[0]?.captureFileChanges).toBe(true)
    expect(drafts.map((draft) => draft.type)).toEqual([
      'tool-result',
      'code-quality-reviewed',
      'context-loaded',
    ])
    expect(drafts[2]).toMatchObject({ slot: 'quality-review', key: 'src/widget.ts' })
    expect(textOf(drafts)).toContain('Code quality note')
  })

  it('keeps the finding in the messages it projects three steps later', async () => {
    const rig = createRig()
    const dispatchDrafts = await new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([new WriteTool()]),
      hooks: new HookChain({ afterTool: [rig.hook] }),
    }).dispatch(dispatchArgs)
    expect(textOf(dispatchDrafts)).toContain('Widget')

    const later: readonly EventDraft[] = [
      { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'still done' }] },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'finished' }] },
    ]
    const events = historyOf([...dispatchDrafts, ...later])
    const assembled = messagesFromEvents()(
      { system: [], messages: [] },
      { events, threadId: THREAD, step: 3, provider: { id: 'fixture', modelId: 'fixture' } },
    )

    const said = assembled.messages.flatMap((entry) =>
      entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    )
    expect(said.some((text) => text.includes('Code quality note'))).toBe(true)
    expect(said.some((text) => text.includes('Widget'))).toBe(true)
  })

  it('asks no tool to capture when the quality setting is off', async () => {
    const rig = createRig({ settings: { enabled: false, policies: {} } })
    const tool = new WriteTool()

    const drafts = await new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([tool]),
      hooks: new HookChain({ afterTool: [rig.hook] }),
    }).dispatch(dispatchArgs)

    expect('captureFileChanges' in (tool.invocations[0] ?? {})).toBe(false)
    expect(drafts.map((draft) => draft.type)).toEqual(['tool-result'])
  })
})

describe('the quality hook identity', () => {
  it('names itself and orders after the other observe hooks', () => {
    const { hook } = createRig()
    expect(hook.name).toBe('quality-review')
    expect(hook.order.nudge).toBeGreaterThan(0)
  })
})
