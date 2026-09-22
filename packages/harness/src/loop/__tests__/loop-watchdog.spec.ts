import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  DecisionPort,
  EToolEffect,
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type DecisionOutcome,
  type Event,
  type EventDraft,
  type ToolDefinition,
} from '@dltech/atlas-core'

import { buildHarness, ELoopWatch, ETurnStatus, jevLoopWatch, type AtlasHarness } from '..'
import { HookChain } from '../../hooks/registry'
import { scriptedModel, type ScriptedStep } from '../../model/testing/scripted-model'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { createTempDatabase, type TempDatabase } from './temp-database'

class FakeDecisions extends DecisionPort {
  calls = 0

  constructor(private readonly outcome: DecisionOutcome) {
    super()
  }

  async decide(): Promise<DecisionOutcome> {
    this.calls += 1
    return this.outcome
  }
}

const looping = (probability: number): DecisionOutcome => ({
  ok: true,
  answers: { loop: { noul: probability } },
})

const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

const watchableEvents = (): Event[] => {
  const drafts: EventDraft[] = [{ type: 'user-said', text: 'ship it' }]
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    drafts.push(
      { type: 'assistant-said', parts: [{ type: 'text', text: `verifying (${ordinal})` }] },
      {
        type: 'tool-called',
        callId: toCallId(`call-${ordinal}`),
        name: 'bash',
        input: { command: `curl -s https://example.com/health?round=${ordinal}` },
        ordinal: 0,
      },
      {
        type: 'tool-result',
        callId: toCallId(`call-${ordinal}`),
        name: 'bash',
        output: { exitCode: 0 },
        modelText: '200 OK',
      },
    )
  }
  return eventsFrom(drafts)
}

const SIGNAL = AbortSignal.timeout(1000)

describe('jevLoopWatch', () => {
  it('does not consult at all while no endpoint is configured', async () => {
    const decisions = new FakeDecisions(looping(0.99))
    const watch = jevLoopWatch({ decisions, enabled: () => false })

    expect(await watch({ events: watchableEvents(), signal: SIGNAL })).toBe(ELoopWatch.Clear)
    expect(decisions.calls).toBe(0)
  })

  it('does not consult below the speech floor', async () => {
    const decisions = new FakeDecisions(looping(0.99))
    const watch = jevLoopWatch({ decisions, enabled: () => true })

    expect(await watch({ events: [], signal: SIGNAL })).toBe(ELoopWatch.Clear)
    expect(decisions.calls).toBe(0)
  })

  it('flags a loop at the threshold and clears below it', async () => {
    const high = jevLoopWatch({ decisions: new FakeDecisions(looping(0.8)), enabled: () => true })
    const low = jevLoopWatch({ decisions: new FakeDecisions(looping(0.1)), enabled: () => true })

    expect(await high({ events: watchableEvents(), signal: SIGNAL })).toBe(ELoopWatch.Looping)
    expect(await low({ events: watchableEvents(), signal: SIGNAL })).toBe(ELoopWatch.Clear)
  })

  it('fails open when the decision model cannot answer', async () => {
    const down = jevLoopWatch({
      decisions: new FakeDecisions({ ok: false, fault: 'answered 502' }),
      enabled: () => true,
    })
    const mute = jevLoopWatch({
      decisions: new FakeDecisions({ ok: true, answers: {} }),
      enabled: () => true,
    })

    expect(await down({ events: watchableEvents(), signal: SIGNAL })).toBe(ELoopWatch.Unreachable)
    expect(await mute({ events: watchableEvents(), signal: SIGNAL })).toBe(ELoopWatch.Unreachable)
  })
})

const touchTool: ToolDefinition = {
  name: 'touch',
  description: 'do nothing at all',
  effect: EToolEffect.Read,
  inputSchema: z.object({ round: z.number() }),
  invoke: async () => ({ ok: true, output: 'touched', modelText: 'touched' }),
}

const varyingSteps = (count: number): ScriptedStep[] =>
  Array.from({ length: count }, (_, index) => ({
    text: `Deployed. Verifying what shipped (${index + 1})`,
    calls: [{ callId: `call-${index + 1}`, name: 'touch', input: { round: index + 1 } }],
  }))

const opened: { harness: AtlasHarness; temp: TempDatabase }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

async function openWatched(args: {
  script: readonly ScriptedStep[]
  watch: (callCount: number) => ELoopWatch
}): Promise<{ harness: AtlasHarness; watches: number }> {
  const temp = createTempDatabase()
  const model = scriptedModel({ script: args.script })
  const registry = new InMemoryToolRegistry([touchTool])
  const counter = { watches: 0 }
  const harness = await buildHarness({
    databaseUrl: temp.databaseUrl,
    model,
    tools: () => registry.declarations(),
    dispatch: new HookedToolDispatcher({ registry, hooks: new HookChain({}) }),
    launchDirectory: '/w',
    watchLoop: async () => {
      counter.watches += 1
      return args.watch(counter.watches)
    },
  })
  opened.push({ harness, temp })
  return { harness, watches: counter.watches }
}

describe('the loop watchdog in a turn', () => {
  it('nudges on the first looping verdict and fails the turn when it keeps looping', async () => {
    const { harness } = await openWatched({
      script: varyingSteps(20),
      watch: () => ELoopWatch.Looping,
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    if (outcome.status !== ETurnStatus.Failed) return
    expect(outcome.message).toContain('watchdog')
    expect(outcome.message).toContain('nudged')

    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'nudge')).toHaveLength(1)
  })

  it('stays out of the way of a turn the watchdog clears', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'all verified' }],
      watch: () => ELoopWatch.Clear,
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.some((event) => event.type === 'nudge')).toBe(false)
  })

  it('treats an unreachable watchdog as clear and never blocks the turn', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'all verified' }],
      watch: () => ELoopWatch.Unreachable,
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
  })

  it('forgives a turn that breaks the pattern after the nudge', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'the probe told me what I needed' }],
      watch: (callCount) => (callCount <= 1 ? ELoopWatch.Looping : ELoopWatch.Clear),
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'nudge')).toHaveLength(1)
  })
})
