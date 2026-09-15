import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { EToolEffect, type ToolDefinition } from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, type AtlasHarness } from '..'
import { HookChain } from '../../hooks/registry'
import { scriptedModel, type ScriptedCall, type ScriptedStep } from '../../model/testing/scripted-model'
import { EApprovalRouting, HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { createTempDatabase, type TempDatabase } from './temp-database'

const PROJECT_DIRECTORY = '/w'

const opened: { harness: AtlasHarness; temp: TempDatabase }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

const touchTool: ToolDefinition = {
  name: 'touch',
  description: 'do nothing at all',
  effect: EToolEffect.Read,
  inputSchema: z.object({}),
  invoke: async () => ({ ok: true, output: 'touched', modelText: 'touched' }),
}

const fakeShell: ToolDefinition = {
  name: 'bash',
  description: 'a shell that always answers the same thing',
  effect: EToolEffect.Destructive,
  inputSchema: z.object({ command: z.string(), runInBackground: z.boolean().optional() }),
  invoke: async () => ({ ok: true, output: 'same', modelText: 'same' }),
}

const callingStep = (ordinal: number, call: Omit<ScriptedCall, 'callId'>): ScriptedStep => ({
  text: `step ${ordinal}`,
  calls: [{ ...call, callId: `call-${ordinal}` }],
})

const pollingSteps = (count: number, call: Omit<ScriptedCall, 'callId'>): ScriptedStep[] =>
  Array.from({ length: count }, (_, index) => callingStep(index + 1, call))

async function openGuarded(args: {
  script: readonly ScriptedStep[]
  tools: readonly ToolDefinition[]
}): Promise<{ harness: AtlasHarness; model: ReturnType<typeof scriptedModel> }> {
  const temp = createTempDatabase()
  const model = scriptedModel({ script: args.script })
  const registry = new InMemoryToolRegistry(args.tools)
  const harness = await buildHarness({
    databaseUrl: temp.databaseUrl,
    model,
    tools: () => registry.declarations(),
    dispatch: new HookedToolDispatcher({
      approvals: EApprovalRouting.Operator,
      registry,
      hooks: new HookChain({}),
    }),
    launchDirectory: PROJECT_DIRECTORY,
  })
  opened.push({ harness, temp })
  return { harness, model }
}

describe('the loop guard', () => {
  it('cuts a run of identical calls with identical results back to the first occurrence', async () => {
    const { harness } = await openGuarded({
      script: [...pollingSteps(3, { name: 'touch', input: {} }), { text: 'done waiting' }],
      tools: [touchTool],
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'poll away' })

    expect(outcome.status).toBe(ETurnStatus.Completed)

    const events = await harness.log.read({ threadId: thread.id })
    const calls = events.filter((event) => event.type === 'tool-called')
    const nudges = events.filter((event) => event.type === 'nudge')

    expect(calls).toHaveLength(1)
    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.type === 'nudge' && nudges[0].text).toContain('touch')
    expect(events.at(-1)?.type).toBe('assistant-said')
  })

  it('cuts again when the model resumes the pattern, then fails the turn on the third loop', async () => {
    const { harness } = await openGuarded({
      script: pollingSteps(20, { name: 'touch', input: {} }),
      tools: [touchTool],
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'poll away' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    if (outcome.status !== ETurnStatus.Failed) return
    expect(outcome.message).toContain('repeated identical touch calls')

    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'tool-called')).toHaveLength(5)
    expect(events.filter((event) => event.type === 'nudge')).toHaveLength(2)
  })

  it('leaves a repeated read-only shell command to the same cut', async () => {
    const { harness } = await openGuarded({
      script: [
        ...pollingSteps(3, { name: 'bash', input: { command: 'git branch --show-current >/dev/null' } }),
        { text: 'done' },
      ],
      tools: [fakeShell],
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'check the branch' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'tool-called')).toHaveLength(1)
  })

  it('never cuts a shell command the classifier cannot prove read-only', async () => {
    const { harness, model } = await openGuarded({
      script: [...pollingSteps(5, { name: 'bash', input: { command: 'bun test' } }), { text: 'green' }],
      tools: [fakeShell],
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'run the suite' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(6)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'tool-called')).toHaveLength(5)
    expect(events.some((event) => event.type === 'nudge')).toBe(false)
  })

  it('never cuts a backgrounded command, which creates a shell', async () => {
    const { harness } = await openGuarded({
      script: [
        ...pollingSteps(4, { name: 'bash', input: { command: 'git status', runInBackground: true } }),
        { text: 'started them all' },
      ],
      tools: [fakeShell],
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'start watching' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'tool-called')).toHaveLength(4)
  })
})
