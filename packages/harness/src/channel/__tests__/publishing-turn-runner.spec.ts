import { afterEach, describe, expect, it } from 'bun:test'

import { defaultPipeline, EMPTY_PROMPT, EToolEffect, type ToolDefinition } from '@dltech/atlas-core'
import { z } from 'zod'

import { createDeltaChannel, PublishingTurnRunner, type ChannelSignal } from '..'
import { buildHarness, ETurnStatus, type AtlasHarness } from '../../loop'
import { scriptedModel, type ScriptedStep } from '../../model/testing/scripted-model'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { HookChain } from '../../hooks/registry'
import { createTempHome, type TempHome } from '../../loop/__tests__/temp-home'

const PROJECT_DIRECTORY = '/w'

const touchTool: ToolDefinition = {
  name: 'touch',
  description: 'do nothing at all',
  effect: EToolEffect.Read,
  inputSchema: z.object({}),
  invoke: async () => ({ ok: true, output: 'touched', modelText: 'touched' }),
}

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

async function openTurn(script: readonly ScriptedStep[]) {
  const temp = createTempHome()
  const harness = await buildHarness({ home: temp.home, model: scriptedModel({ script }) })
  opened.push({ harness, temp })

  const channel = createDeltaChannel()
  const seen: ChannelSignal[] = []
  const thread = await harness.threads.create({})
  channel.subscribe({ threadId: thread.id, listener: (signal) => void seen.push(signal) })

  const tools = new InMemoryToolRegistry([touchTool])
  const runner = new PublishingTurnRunner({
    channel,
    deps: {
      log: harness.log,
      model: harness.model,
      ids: harness.ids,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: PROJECT_DIRECTORY }),
      tools: () => tools.declarations(),
      dispatch: new HookedToolDispatcher({ registry: tools, hooks: new HookChain({}) }),
    },
  })

  return { threadId: thread.id, runner, seen }
}

const workingsOf = (seen: readonly ChannelSignal[]) =>
  seen.filter((signal) => signal.type === 'turn-working')

describe('the working state a published turn announces', () => {
  it('reads working across the gap between steps, so a turn boundary is never idle', async () => {
    const { runner, threadId, seen } = await openTurn([
      { calls: [{ callId: 'call-1', name: 'touch', input: {} }] },
      { text: 'done' },
    ])

    const outcome = await runner.say({ threadId, text: 'go' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(workingsOf(seen)).toEqual([
      { type: 'turn-working', working: true },
      { type: 'turn-working', working: false },
    ])
    expect(seen[0]?.type).toBe('turn-working')
    expect(seen.at(-1)?.type).toBe('turn-working')

    const endedAt = seen.findIndex((signal) => signal.type === 'step-ended')
    const restartedAt = seen.findIndex(
      (signal, index) => index > endedAt && signal.type === 'step-started',
    )
    const workingAt = seen.findIndex((signal) => signal.type === 'turn-working')
    expect(workingAt).toBeLessThan(endedAt)
    expect(workingAt).toBeLessThan(restartedAt)
  })

  it('announces idle even when the turn fails before a step settles', async () => {
    const { runner, threadId, seen } = await openTurn([{ error: new Error('the model is down') }])

    const outcome = await runner.say({ threadId, text: 'go' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(workingsOf(seen)).toEqual([
      { type: 'turn-working', working: true },
      { type: 'turn-working', working: false },
    ])
  })
})
