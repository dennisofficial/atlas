import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  defaultPipeline,
  EMPTY_PROMPT,
  ERunFailureKind,
  EToolEffect,
  toCallId,
  toRunId,
  type Event,
  type EventDraft,
  type ModelPort,
} from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, LoopTurnRunner, type AtlasHarness } from '..'
import { scriptedModel } from '../../model/testing/scripted-model'
import { TurnFault } from '../../model/turn-fault'
import { HookChain } from '../../hooks/registry'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { idleOrSwallowed, unsettledCall } from '../swallowed-outcome'
import type { PendingDrain } from '../run-turn'
import { createTempHome, type TempHome } from './temp-home'

const PROJECT_DIRECTORY = '/w'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

const registry = new InMemoryToolRegistry([
  {
    name: 'probe',
    description: 'a probe',
    effect: EToolEffect.Read,
    inputSchema: z.object({}),
    invoke: async () => ({ ok: true, output: {}, modelText: 'probed' }),
  },
])

async function runProbeTurn(args: { wakeAfterStep: number }) {
  const temp = createTempHome()
  const model = scriptedModel({
    script: [
      { text: 'probing', calls: [{ callId: 'call-1', name: 'probe', input: {} }] },
      { text: 'all done' },
    ],
  })
  const harness = await buildHarness({ home: temp.home, model })
  opened.push({ harness, temp })
  const thread = await harness.threads.create({})

  let steps = 0
  let woken = false
  const drainPending = async (): Promise<PendingDrain> => {
    if (steps < args.wakeAfterStep || woken) return { drafts: [], wakesTurn: false }
    woken = true
    return { drafts: [], wakesTurn: true }
  }
  const counting: ModelPort = {
    identity: harness.model.identity,
    step: async (stepArgs) => {
      const result = await harness.model.step(stepArgs)
      steps += 1
      return result
    },
  }

  const runner = new LoopTurnRunner({
    launchDirectory: process.cwd(),
    log: harness.log,
    model: counting,
    ids: harness.ids,
    assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: PROJECT_DIRECTORY }),
    tools: () => registry.declarations(),
    dispatch: new HookedToolDispatcher({ registry, hooks: new HookChain({}) }),
    intake: { prepare: drainPending },
  })
  return runner.say({ threadId: thread.id, text: 'probe it' })
}

describe('a turn that finished after settling its tool call', () => {
  it('goes idle rather than failing when an intake drain wakes the turn without a turn-taking draft', async () => {
    const outcome = await runProbeTurn({ wakeAfterStep: 2 })

    expect(outcome.status).toBe(ETurnStatus.Idle)
  })
})

describe('a tool call the log never settles', () => {
  const committed = [{ callId: toCallId('call-1'), name: 'probe' }]
  const called: EventDraft = {
    type: 'tool-called',
    callId: toCallId('call-1'),
    name: 'probe',
    input: {},
    ordinal: 0,
  }
  const resulted: EventDraft = {
    type: 'tool-result',
    callId: toCallId('call-1'),
    name: 'probe',
    output: 'ok',
  }
  const rows = (drafts: EventDraft[]): Event[] =>
    drafts.map((draft, seq) => ({ ...draft, seq }) as unknown as Event)

  it('is reported when the log holds no tool-called row for it', () => {
    expect(unsettledCall({ committed, owned: [] })).toEqual(committed[0])
  })

  it('is reported when the log holds the call but no result or denial', () => {
    expect(unsettledCall({ committed, owned: rows([called]) })).toEqual(committed[0])
  })

  it('is not reported once a result settles it', () => {
    expect(unsettledCall({ committed, owned: rows([called, resulted]) })).toBeUndefined()
  })

  it('fails the turn as a tool settlement fault', () => {
    const outcome = idleOrSwallowed({ swallowed: committed[0], runId: toRunId('run-1') })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    if (outcome.status !== ETurnStatus.Failed) return
    expect((outcome.cause as TurnFault).kind).toBe(ERunFailureKind.ToolSettlement)
  })
})
