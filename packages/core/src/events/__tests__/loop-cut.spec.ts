import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toCallId, toEventId, toRunId, toThreadId } from '../ids'
import { loopCutNoticeDraft, loopCutPlan } from '../loop-cut'
import { stampDrafts } from '../stamp'

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

const said = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const called = (args: { callId: string; name?: string; input?: unknown; ordinal?: number }): EventDraft => ({
  type: 'tool-called',
  callId: toCallId(args.callId),
  name: args.name ?? 'bash',
  input: args.input ?? { command: 'git branch --show-current >/dev/null' },
  ordinal: args.ordinal ?? 0,
})

const resulted = (args: { callId: string; name?: string; modelText?: string }): EventDraft => ({
  type: 'tool-result',
  callId: toCallId(args.callId),
  name: args.name ?? 'bash',
  output: { exitCode: 0 },
  modelText: args.modelText ?? 'exit code 0',
})

const denied = (args: { callId: string; reason?: string }): EventDraft => ({
  type: 'tool-denied',
  callId: toCallId(args.callId),
  name: 'bash',
  reason: args.reason ?? 'this command does nothing',
})

const probeRound = (ordinal: number, text?: string): EventDraft[] => [
  said(text ?? `waiting ${ordinal}`),
  called({ callId: `call-${ordinal}` }),
  resulted({ callId: `call-${ordinal}` }),
]

const everything = (): boolean => true

describe('loopCutPlan', () => {
  it('finds nothing on an empty or purely spoken thread', () => {
    expect(loopCutPlan({ events: [], repeatable: everything })).toBeUndefined()
    expect(
      loopCutPlan({ events: eventsFrom([said('a'), said('b'), said('c')]), repeatable: everything }),
    ).toBeUndefined()
  })

  it('finds nothing below three identical occurrences', () => {
    const events = eventsFrom([...probeRound(1), ...probeRound(2)])

    expect(loopCutPlan({ events, repeatable: everything })).toBeUndefined()
  })

  it('keeps the first occurrence and cuts the rest of a three-occurrence run', () => {
    const events = eventsFrom([...probeRound(1), ...probeRound(2), ...probeRound(3)])

    const plan = loopCutPlan({ events, repeatable: everything })

    expect(plan).toEqual({
      toSeq: 3,
      throughSeq: 9,
      repeats: 2,
      roundsCut: 2,
      names: ['bash'],
    })
  })

  it('cuts a long run back to exactly the first occurrence', () => {
    const drafts = Array.from({ length: 6 }, (_, index) => probeRound(index + 1)).flat()
    const events = eventsFrom(drafts)

    const plan = loopCutPlan({ events, repeatable: everything })

    expect(plan?.toSeq).toBe(3)
    expect(plan?.repeats).toBe(5)
    expect(plan?.roundsCut).toBe(5)
  })

  it('ignores the wording of the assistant text between identical calls', () => {
    const events = eventsFrom([
      ...probeRound(1, 'still running'),
      ...probeRound(2, 'no tool calls this time'),
      ...probeRound(3, 'ending the turn'),
    ])

    expect(loopCutPlan({ events, repeatable: everything })?.repeats).toBe(2)
  })

  it('does not fire when the results differ', () => {
    const events = eventsFrom([
      said('one'),
      called({ callId: 'call-1' }),
      resulted({ callId: 'call-1', modelText: '10 passed' }),
      said('two'),
      called({ callId: 'call-2' }),
      resulted({ callId: 'call-2', modelText: '9 passed' }),
      said('three'),
      called({ callId: 'call-3' }),
      resulted({ callId: 'call-3', modelText: '8 passed' }),
    ])

    expect(loopCutPlan({ events, repeatable: everything })).toBeUndefined()
  })

  it('does not fire when the inputs differ', () => {
    const round = (ordinal: number, path: string): EventDraft[] => [
      said(`read ${path}`),
      called({ callId: `call-${ordinal}`, name: 'read', input: { path } }),
      resulted({ callId: `call-${ordinal}`, name: 'read' }),
    ]
    const events = eventsFrom([...round(1, '/a'), ...round(2, '/b'), ...round(3, '/c')])

    expect(loopCutPlan({ events, repeatable: everything })).toBeUndefined()
  })

  it('does not fire across a barrier event, however small', () => {
    const events = eventsFrom([
      ...probeRound(1),
      ...probeRound(2),
      { type: 'background-shell-still-running', shellId: 'bash_1', command: 'bun test', runningForMs: 1, silentForMs: 1, checkInMs: 1, tail: '' },
      ...probeRound(3),
      ...probeRound(4),
    ])

    expect(loopCutPlan({ events, repeatable: everything })).toBeUndefined()
  })

  it('does not fire across a user message', () => {
    const events = eventsFrom([
      ...probeRound(1),
      ...probeRound(2),
      { type: 'user-said', text: 'stop that' },
      ...probeRound(3),
      ...probeRound(4),
    ])

    expect(loopCutPlan({ events, repeatable: everything })).toBeUndefined()
  })

  it('does not fire while the last call is unsettled', () => {
    const events = eventsFrom([
      ...probeRound(1),
      ...probeRound(2),
      said('three'),
      called({ callId: 'call-3' }),
    ])

    expect(loopCutPlan({ events, repeatable: everything })).toBeUndefined()
  })

  it('does not fire when the run is not the tail', () => {
    const events = eventsFrom([
      ...probeRound(1),
      ...probeRound(2),
      ...probeRound(3),
      { type: 'user-said', text: 'thanks' },
    ])

    expect(loopCutPlan({ events, repeatable: everything })).toBeUndefined()
  })

  it('refuses a run whose calls the predicate cannot prove repeatable', () => {
    const events = eventsFrom([...probeRound(1), ...probeRound(2), ...probeRound(3)])

    expect(loopCutPlan({ events, repeatable: () => false })).toBeUndefined()
  })

  it('cuts repeated identical refusals, which carry no effect by construction', () => {
    const refusedRound = (ordinal: number): EventDraft[] => [
      said(`trying ${ordinal}`),
      called({ callId: `call-${ordinal}`, input: { command: 'true' } }),
      denied({ callId: `call-${ordinal}` }),
    ]
    const events = eventsFrom([...refusedRound(1), ...refusedRound(2), ...refusedRound(3)])

    expect(loopCutPlan({ events, repeatable: everything })?.repeats).toBe(2)
  })

  it('cuts repeats of a destructive command that was denied every time', () => {
    const refusedRound = (ordinal: number): EventDraft[] => [
      said(`trying ${ordinal}`),
      called({ callId: `call-${ordinal}`, input: { command: 'rm -rf /' } }),
      denied({ callId: `call-${ordinal}`, reason: 'needs approval' }),
    ]
    const events = eventsFrom([...refusedRound(1), ...refusedRound(2), ...refusedRound(3)])

    expect(loopCutPlan({ events, repeatable: () => false })?.repeats).toBe(2)
  })

  it('detects a repeating two-round unit', () => {
    const unit = (ordinal: number): EventDraft[] => [
      said(`tick ${ordinal}`),
      called({ callId: `list-${ordinal}`, name: 'shell_list', input: { runningOnly: true } }),
      resulted({ callId: `list-${ordinal}`, name: 'shell_list', modelText: 'one shell' }),
      said(`tick ${ordinal} again`),
      called({ callId: `branch-${ordinal}` }),
      resulted({ callId: `branch-${ordinal}` }),
    ]
    const events = eventsFrom([...unit(1), ...unit(2), ...unit(3)])

    const plan = loopCutPlan({ events, repeatable: everything })

    expect(plan?.repeats).toBe(2)
    expect(plan?.roundsCut).toBe(4)
    expect(plan?.names).toEqual(['shell_list', 'bash'])
    expect(plan?.toSeq).toBe(6)
  })

  it('compares multi-call rounds as a whole', () => {
    const doubleRound = (ordinal: number): EventDraft[] => [
      said(`pair ${ordinal}`),
      called({ callId: `a-${ordinal}`, name: 'read', input: { path: '/a' }, ordinal: 0 }),
      called({ callId: `b-${ordinal}`, name: 'read', input: { path: '/b' }, ordinal: 1 }),
      resulted({ callId: `a-${ordinal}`, name: 'read', modelText: 'aaa' }),
      resulted({ callId: `b-${ordinal}`, name: 'read', modelText: 'bbb' }),
    ]
    const events = eventsFrom([...doubleRound(1), ...doubleRound(2), ...doubleRound(3)])

    expect(loopCutPlan({ events, repeatable: everything })?.repeats).toBe(2)
  })

  it('treats differing settlement order inside a round as a different round', () => {
    const first: EventDraft[] = [
      said('pair'),
      called({ callId: 'a-1', name: 'read', input: { path: '/a' }, ordinal: 0 }),
      called({ callId: 'b-1', name: 'read', input: { path: '/b' }, ordinal: 1 }),
      resulted({ callId: 'a-1', name: 'read', modelText: 'aaa' }),
      resulted({ callId: 'b-1', name: 'read', modelText: 'bbb' }),
    ]
    const swapped = (ordinal: number): EventDraft[] => [
      said('pair'),
      called({ callId: `a-${ordinal}`, name: 'read', input: { path: '/a' }, ordinal: 0 }),
      called({ callId: `b-${ordinal}`, name: 'read', input: { path: '/b' }, ordinal: 1 }),
      resulted({ callId: `b-${ordinal}`, name: 'read', modelText: 'bbb' }),
      resulted({ callId: `a-${ordinal}`, name: 'read', modelText: 'aaa' }),
    ]
    const events = eventsFrom([...first, ...swapped(2), ...swapped(3)])

    expect(loopCutPlan({ events, repeatable: everything })).toBeUndefined()
  })
})

describe('loopCutNoticeDraft', () => {
  it('names the tools and states that the repeats left the history', () => {
    const draft = loopCutNoticeDraft({ names: ['bash'], repeats: 4 })

    expect(draft.type).toBe('nudge')
    if (draft.type !== 'nudge') return
    expect(draft.text).toContain('bash')
    expect(draft.text).toContain('4 times')
    expect(draft.lifetimeSteps).toBeGreaterThan(1)
  })
})
