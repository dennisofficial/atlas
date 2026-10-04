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

import { buildHarness, ELoopWatch, ETurnStatus, jevLoopWatch, type AtlasHarness, type LoopVerdict } from '..'
import { HookChain } from '../../hooks/registry'
import { scriptedModel, type ScriptedStep } from '../../model/testing/scripted-model'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { createTempHome, type TempHome } from './temp-home'

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

const looping = (probability: number, loopStart?: string): DecisionOutcome => ({
  ok: true,
  answers: {
    loop: { noul: probability },
    ...(loopStart === undefined ? {} : { 'loop-start': { choice: loopStart } }),
  },
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
  const speeches = [
    'Read the deploy logs to see what shipped',
    'The health endpoint answers 200; now checking the database migration',
    'Migration applied cleanly; drafting the release notes next',
  ]
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    drafts.push(
      { type: 'assistant-said', parts: [{ type: 'text', text: speeches[ordinal - 1] ?? '' }] },
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

    expect((await watch({ events: watchableEvents(), signal: SIGNAL })).verdict).toBe(ELoopWatch.Clear)
    expect(decisions.calls).toBe(0)
  })

  it('holds its verdict below the speech floor rather than clearing', async () => {
    const decisions = new FakeDecisions(looping(0.99))
    const watch = jevLoopWatch({ decisions, enabled: () => true })

    expect((await watch({ events: [], signal: SIGNAL })).verdict).toBe(ELoopWatch.NoVerdict)
    expect(decisions.calls).toBe(0)
  })

  it('flags a loop at the threshold and clears below it', async () => {
    const high = jevLoopWatch({ decisions: new FakeDecisions(looping(0.8)), enabled: () => true })
    const low = jevLoopWatch({ decisions: new FakeDecisions(looping(0.1)), enabled: () => true })

    const highVerdict = await high({ events: watchableEvents(), signal: SIGNAL })
    const lowVerdict = await low({ events: watchableEvents(), signal: SIGNAL })
    expect(highVerdict).toEqual({ verdict: ELoopWatch.Looping, loopStartSeq: undefined, noul: 0.8 })
    expect(lowVerdict).toEqual({ verdict: ELoopWatch.Clear, noul: 0.1 })
  })

  it('reads the judge\'s loop-start pick only when it names a rendered step', async () => {
    const pointed = jevLoopWatch({
      decisions: new FakeDecisions(looping(0.8, '2')),
      enabled: () => true,
    })
    const unreadable = jevLoopWatch({
      decisions: new FakeDecisions(looping(0.8, 'the second one')),
      enabled: () => true,
    })
    const offWindow = jevLoopWatch({
      decisions: new FakeDecisions(looping(0.8, '999')),
      enabled: () => true,
    })

    expect((await pointed({ events: watchableEvents(), signal: SIGNAL })).loopStartSeq).toBe(2)
    expect((await unreadable({ events: watchableEvents(), signal: SIGNAL })).loopStartSeq).toBeUndefined()
    expect((await offWindow({ events: watchableEvents(), signal: SIGNAL })).loopStartSeq).toBeUndefined()
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

    expect(await down({ events: watchableEvents(), signal: SIGNAL })).toEqual({
      verdict: ELoopWatch.Unreachable,
      fault: 'answered 502',
    })
    expect(await mute({ events: watchableEvents(), signal: SIGNAL })).toEqual({
      verdict: ELoopWatch.Unreachable,
      fault: 'the decision model gave no loop probability',
    })
  })

  it('catches a speech echo even when the decision model cannot answer', async () => {
    const echoing = (): Event[] => {
      const drafts: EventDraft[] = [{ type: 'user-said', text: 'wire the emitter' }]
      for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
        drafts.push(
          {
            type: 'assistant-said',
            parts: [
              {
                type: 'text',
                text: "I'm in the right worktree. Now let me check how composeHarness exposes plugin ports so I can reach the github bridge",
              },
            ],
          },
          {
            type: 'tool-called',
            callId: toCallId(`call-${ordinal}`),
            name: 'read',
            input: { path: 'compose.ts', offset: ordinal * 60 },
            ordinal: 0,
          },
          {
            type: 'tool-result',
            callId: toCallId(`call-${ordinal}`),
            name: 'read',
            output: { exitCode: 0 },
            modelText: `line ${ordinal * 60}`,
          },
        )
      }
      return eventsFrom(drafts)
    }

    const down = jevLoopWatch({
      decisions: new FakeDecisions({ ok: false, fault: 'answered 502' }),
      enabled: () => true,
    })
    const low = jevLoopWatch({
      decisions: new FakeDecisions(looping(0.21)),
      enabled: () => true,
    })

    const downVerdict = await down({ events: echoing(), signal: SIGNAL })
    expect(downVerdict.verdict).toBe(ELoopWatch.Looping)
    expect(downVerdict.loopStartSeq).toBe(2)

    const lowVerdict = await low({ events: echoing(), signal: SIGNAL })
    expect(lowVerdict.verdict).toBe(ELoopWatch.Looping)
    expect(lowVerdict.noul).toBe(0.21)
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

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

async function openWatched(args: {
  script: readonly ScriptedStep[]
  watch: (callCount: number, events: readonly Event[]) => LoopVerdict
}): Promise<{ harness: AtlasHarness; watches: number }> {
  const temp = createTempHome()
  const model = scriptedModel({ script: args.script })
  const registry = new InMemoryToolRegistry([touchTool])
  const counter = { watches: 0 }
  const harness = await buildHarness({
    home: temp.home,
    model,
    tools: () => registry.declarations(),
    dispatch: new HookedToolDispatcher({ registry, hooks: new HookChain({}) }),
    launchDirectory: '/w',
    watchLoop: async ({ events }) => {
      counter.watches += 1
      return args.watch(counter.watches, events)
    },
  })
  opened.push({ harness, temp })
  return { harness, watches: counter.watches }
}

const earliestSpeech = (events: readonly Event[]): number | undefined =>
  events.find((event) => event.type === 'assistant-said')?.seq

const nudgeTexts = (events: readonly Event[]): string[] =>
  events.flatMap((event) => (event.type === 'nudge' ? [event.text] : []))

describe('the loop watchdog in a turn', () => {
  it('nudges on the first looping verdict and ends the turn idle when it keeps looping', async () => {
    const { harness } = await openWatched({
      script: varyingSteps(20),
      watch: () => ({ verdict: ELoopWatch.Looping }),
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Idle)

    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'nudge')).toHaveLength(1)
  })

  it('keeps the warning armed through steps too small to judge, so escalation still lands', async () => {
    const { harness } = await openWatched({
      script: varyingSteps(20),
      watch: (callCount) =>
        callCount === 2 ? { verdict: ELoopWatch.NoVerdict } : { verdict: ELoopWatch.Looping },
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Idle)

    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'nudge')).toHaveLength(1)
  })

  it('stays out of the way of a turn the watchdog clears', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'all verified' }],
      watch: () => ({ verdict: ELoopWatch.Clear }),
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
      watch: () => ({ verdict: ELoopWatch.Unreachable }),
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
  })

  it('forgives a turn that breaks the pattern after the nudge', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'the probe told me what I needed' }],
      watch: (callCount) =>
        callCount <= 1 ? { verdict: ELoopWatch.Looping } : { verdict: ELoopWatch.Clear },
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const events = await harness.log.read({ threadId: thread.id })
    expect(events.filter((event) => event.type === 'nudge')).toHaveLength(1)
  })

  it('cuts the steps the judge points at instead of nudging first', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'all verified' }],
      watch: (_callCount, events) => {
        const speech = earliestSpeech(events)
        if (speech === undefined) return { verdict: ELoopWatch.NoVerdict }
        if (speech !== 2) return { verdict: ELoopWatch.Clear }
        return { verdict: ELoopWatch.Looping, loopStartSeq: speech }
      },
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const events = await harness.log.read({ threadId: thread.id })
    const nudges = nudgeTexts(events)
    expect(nudges).toHaveLength(1)
    expect(nudges[0]).toContain('cut')
    expect(events.some((event) => event.type === 'assistant-said' && event.parts.some((part) => part.type === 'text' && part.text.includes('(1)')))).toBe(false)
  })

  it('records each consulted verdict in the log, with its probability and pick', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'all verified' }],
      watch: (_callCount, events) => {
        const speech = earliestSpeech(events)
        if (speech === undefined) return { verdict: ELoopWatch.NoVerdict }
        if (speech !== 2) return { verdict: ELoopWatch.Clear, noul: 0.12 }
        return { verdict: ELoopWatch.Looping, loopStartSeq: speech, noul: 0.83 }
      },
    })
    const thread = await harness.threads.create({})

    await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    const verdicts = (await harness.log.read({ threadId: thread.id })).filter(
      (event) => event.type === 'loop-watch-verdict',
    )
    expect(verdicts.length).toBeGreaterThan(0)
    expect(verdicts.some((event) => event.looping && event.probability === 0.83 && event.loopStartSeq === 2)).toBe(
      true,
    )
  })

  it('records an unreachable judge with its fault instead of a probability', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'all verified' }],
      watch: () => ({ verdict: ELoopWatch.Unreachable, fault: 'answered 502' }),
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const verdicts = (await harness.log.read({ threadId: thread.id })).filter(
      (event) => event.type === 'loop-watch-verdict',
    )
    expect(verdicts.length).toBeGreaterThan(0)
    expect(verdicts.every((event) => event.consulted && !event.looping && event.fault === 'answered 502')).toBe(true)
  })

  it('records a cleared verdict with the probability the judge scored', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'all verified' }],
      watch: () => ({ verdict: ELoopWatch.Clear, noul: 0.12 }),
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    const verdicts = (await harness.log.read({ threadId: thread.id })).filter(
      (event) => event.type === 'loop-watch-verdict',
    )
    expect(verdicts.length).toBeGreaterThan(0)
    expect(verdicts.every((event) => !event.looping && event.probability === 0.12)).toBe(true)
  })

  it('writes no verdict row when the window never grew large enough to judge', async () => {
    const { harness } = await openWatched({
      script: [...varyingSteps(3), { text: 'all verified' }],
      watch: () => ({ verdict: ELoopWatch.NoVerdict }),
    })
    const thread = await harness.threads.create({})

    await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    const verdicts = (await harness.log.read({ threadId: thread.id })).filter(
      (event) => event.type === 'loop-watch-verdict',
    )
    expect(verdicts).toHaveLength(0)
  })

  it('gives a re-forming loop two cuts, then nudges, then stops the turn idle', async () => {
    const { harness } = await openWatched({
      script: varyingSteps(20),
      watch: (_callCount, events) => {
        const speech = earliestSpeech(events)
        if (speech === undefined) return { verdict: ELoopWatch.NoVerdict }
        return { verdict: ELoopWatch.Looping, loopStartSeq: speech }
      },
    })
    const thread = await harness.threads.create({})

    const outcome = await harness.runner.say({ threadId: thread.id, text: 'verify the deploy' })

    expect(outcome.status).toBe(ETurnStatus.Idle)
    const events = await harness.log.read({ threadId: thread.id })
    const nudges = nudgeTexts(events)
    expect(nudges.filter((text) => text.includes('cut'))).toHaveLength(2)
    expect(nudges.filter((text) => text.includes('judged this turn to be looping'))).toHaveLength(1)
  })
})
