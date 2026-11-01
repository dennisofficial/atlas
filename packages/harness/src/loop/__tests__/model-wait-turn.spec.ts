import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  defaultPipeline,
  EMPTY_PROMPT,
  EToolEffect,
  type ModelPort,
  type ToolDefinition,
} from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { blockedError } from '../../model-recovery/__tests__/block-fixtures'
import { ModelWaitState } from '../../model-recovery/wait-state'
import { scriptedModel } from '../../model/testing/scripted-model'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { buildHarness, LoopTurnRunner, type AtlasHarness } from '..'
import { ETurnStatus } from '../turn-outcome'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

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

async function openDenied(args: { admittedSteps: number }) {
  const temp = createTempHome()
  const scripted = scriptedModel({
    script: [
      {
        text: 'working',
        calls: [{ callId: 'call-1', name: 'touch', input: {} }],
      },
    ],
  })
  const harness = await buildHarness({ home: temp.home, model: scripted })
  opened.push({ harness, temp })
  const thread = await harness.threads.create({})
  const registry = new InMemoryToolRegistry([touchTool])

  let steps = 0
  const gated: ModelPort = {
    identity: harness.model.identity,
    step: async (stepArgs) => {
      steps += 1
      if (steps > args.admittedSteps) throw blockedError()
      return harness.model.step(stepArgs)
    },
  }
  const sleeps: number[] = []
  let giveUps = 0
  const waitState = new ModelWaitState({
    log: harness.log,
    ids: harness.ids,
    threads: harness.threads,
  })
  const runner = new LoopTurnRunner({
    log: harness.log,
    model: gated,
    ids: harness.ids,
    assembly: defaultPipeline({
      prompt: () => EMPTY_PROMPT,
      launchDirectory: '/w',
    }),
    tools: () => registry.declarations(),
    dispatch: new HookedToolDispatcher({ registry, hooks: new HookChain({}) }),
    waitState,
    retry: {
      sleep: async ({ ms }) => {
        sleeps.push(ms)
      },
      onGiveUp: () => {
        giveUps += 1
        return false
      },
    },
  })
  return {
    harness,
    thread,
    runner,
    waitState,
    sleeps,
    giveUps: () => giveUps,
    steps: () => steps,
  }
}

describe('a gate denial at the model step', () => {
  it('ends the turn as WaitingForModel after settling pending tools, without a failure', async () => {
    const rig = await openDenied({ admittedSteps: 1 })

    const outcome = await rig.runner.say({
      threadId: rig.thread.id,
      text: 'go',
    })

    expect(outcome.status).toBe(ETurnStatus.WaitingForModel)
    const types = (await rig.harness.log.readOwn({ threadId: rig.thread.id })).map(
      (event) => event.type,
    )
    expect(types).toContain('tool-result')
    expect(types).not.toContain('run-failed')
    expect(types).toContain('model-waiting')
  })

  it('carries the episode, scope and provider-evidenced reset on the outcome', async () => {
    const rig = await openDenied({ admittedSteps: 0 })

    const outcome = await rig.runner.say({
      threadId: rig.thread.id,
      text: 'go',
    })

    if (outcome.status !== ETurnStatus.WaitingForModel) throw new Error('expected waiting')
    expect(outcome.waiting.providerId).toBe('anthropic')
    expect(outcome.waiting.resetAt).toBeNull()
    expect(outcome.waiting.affectedThreadIds).toEqual([rig.thread.id])
  })

  it('makes one provider attempt: no retry sleep, no give-up consultation, one model step', async () => {
    const rig = await openDenied({ admittedSteps: 0 })

    await rig.runner.say({ threadId: rig.thread.id, text: 'go' })

    expect(rig.steps()).toBe(1)
    expect(rig.sleeps).toEqual([])
    expect(rig.giveUps()).toBe(0)
  })

  it('marks the thread blocked, and a later admitted step clears the wait', async () => {
    const rig = await openDenied({ admittedSteps: 0 })
    await rig.runner.say({ threadId: rig.thread.id, text: 'go' })
    expect(rig.waitState.blocked({ threadId: rig.thread.id })).toBe(true)

    await rig.waitState.admitted({ threadId: rig.thread.id })

    expect(rig.waitState.blocked({ threadId: rig.thread.id })).toBe(false)
  })
})
