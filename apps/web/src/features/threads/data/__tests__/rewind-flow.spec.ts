import { describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'
import { EPodState, EShellStatus, rosterWireSchema, type RosterWire } from '@dltech/atlas-wire/web'

import { ERewindRoute, planRewind, rewindRouteOf } from '../rewind'
import {
  applyRewindPick,
  decideRewind,
  ERewindDecision,
  REWIND_WAITS_FOR_SANDBOX,
  REWIND_WAITS_FOR_TURN,
  type RewindPick,
  type RewindSituation,
} from '../rewind-flow'

const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt_${index}`),
      seq: index,
      threadId: toThreadId('thr_1'),
      runId: toRunId('run_1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 9, 28, 10, 0, index)).toISOString(),
    })),
  })

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})
const spawned: EventDraft = {
  type: 'agent-spawned',
  agentId: toThreadId('thr_child'),
  agentType: 'explore',
  intent: 'vault audit',
  mode: EAgentStart.Fresh,
}
const shellStarted = (description: string | undefined): EventDraft => ({
  type: 'background-shell-started',
  shellId: 'bash_1',
  command: 'npm   test',
  ...(description === undefined ? {} : { description }),
})

const plain = eventsFrom([said('one'), replied('two'), said('three')])
const withAgent = eventsFrom([said('one'), replied('two'), said('three'), spawned])

const situationOf = (change: Partial<RewindSituation>): RewindSituation => ({
  threadId: 'thr_1',
  events: plain,
  live: true,
  working: false,
  podState: EPodState.Running,
  ...change,
})

const shellRoster = (threadId: string): RosterWire =>
  rosterWireSchema.parse({
    agents: [],
    services: [],
    shells: [
      {
        shellId: 'bash_1',
        threadId,
        command: 'npm test',
        description: '',
        status: EShellStatus.Running,
        startedAt: '2026-10-28T10:00:00.000Z',
        lastOutputAt: '2026-10-28T10:00:00.000Z',
        totalCharacters: 0,
        awaitingInput: false,
      },
    ],
  })

describe('rewindRouteOf', () => {
  it('waits for a turn in flight before anything else', () => {
    expect(rewindRouteOf({ live: true, working: true, podState: EPodState.Running })).toBe(
      ERewindRoute.WaitForTurn,
    )
  })

  it('goes over the channel while live', () => {
    expect(rewindRouteOf({ live: true, working: false, podState: EPodState.Running })).toBe(
      ERewindRoute.Live,
    )
  })

  it('goes through the API only while the sandbox is down', () => {
    const routes = [EPodState.Parked, EPodState.None, EPodState.Failed].map((podState) =>
      rewindRouteOf({ live: false, working: false, podState }),
    )
    expect(routes).toEqual([ERewindRoute.Offline, ERewindRoute.Offline, ERewindRoute.Offline])
  })

  it('refuses while a running or booting sandbox is not yet live', () => {
    const routes = [EPodState.Running, EPodState.Booting, null].map((podState) =>
      rewindRouteOf({ live: false, working: false, podState }),
    )
    expect(routes).toEqual([
      ERewindRoute.Reconnecting,
      ERewindRoute.Reconnecting,
      ERewindRoute.Reconnecting,
    ])
  })
})

describe('decideRewind', () => {
  it('warns mid-turn with the TUI notice', () => {
    const decision = decideRewind({
      situation: situationOf({ working: true }),
      eventId: 'evt_2',
      text: 'three',
      roster: null,
    })
    expect(decision).toEqual({ kind: ERewindDecision.Warn, message: REWIND_WAITS_FOR_TURN })
  })

  it('warns while a running sandbox is reconnecting instead of rewinding the mirror', () => {
    const decision = decideRewind({
      situation: situationOf({ live: false }),
      eventId: 'evt_2',
      text: 'three',
      roster: null,
    })
    expect(decision).toEqual({ kind: ERewindDecision.Warn, message: REWIND_WAITS_FOR_SANDBOX })
  })

  it('applies at once with the row text when nothing would be killed', () => {
    const decision = decideRewind({
      situation: situationOf({}),
      eventId: 'evt_2',
      text: 'three\nand more',
      roster: null,
    })
    expect(decision).toMatchObject({
      kind: ERewindDecision.Apply,
      pick: { route: ERewindRoute.Live, toSeq: 1, text: 'three\nand more', kills: [] },
    })
  })

  it('asks for confirmation when the rewind kills something', () => {
    const decision = decideRewind({
      situation: situationOf({ events: withAgent, live: false, podState: EPodState.Parked }),
      eventId: 'evt_2',
      text: 'three',
      roster: null,
    })
    expect(decision).toMatchObject({
      kind: ERewindDecision.Confirm,
      pick: { route: ERewindRoute.Offline, cutAgents: ['thr_child'] },
    })
  })

  it('ignores an event that is not a rewind point', () => {
    const decision = decideRewind({
      situation: situationOf({}),
      eventId: 'evt_0',
      text: 'one',
      roster: null,
    })
    expect(decision).toEqual({ kind: ERewindDecision.Ignore })
  })
})

describe('applyRewindPick', () => {
  const pickOf = (route: RewindPick['route']): RewindPick => ({
    route,
    toSeq: 1,
    text: 'three',
    cuts: [],
    cutAgents: ['thr_child'],
    kills: [],
  })

  const recorder = () => {
    const calls: unknown[] = []
    return {
      calls,
      appliers: {
        applyLive: async (args: unknown) => void calls.push(['live', args]),
        applyOffline: async (args: unknown) => void calls.push(['offline', args]),
        refreshEvents: () => void calls.push(['refresh']),
      },
    }
  }

  it('sends a live pick over the channel only', async () => {
    const { calls, appliers } = recorder()
    await applyRewindPick({ threadId: 'thr_1', pick: pickOf(ERewindRoute.Live), appliers })
    expect(calls).toEqual([['live', { cuts: [], toSeq: 1 }]])
  })

  it('rewinds an offline pick through the API and re-reads the events', async () => {
    const { calls, appliers } = recorder()
    await applyRewindPick({ threadId: 'thr_1', pick: pickOf(ERewindRoute.Offline), appliers })
    expect(calls).toEqual([
      ['offline', { threadId: 'thr_1', toSeq: 1, cutAgents: ['thr_child'] }],
      ['refresh'],
    ])
  })
})

describe('planRewind shells', () => {
  const shellEvents = (description: string | undefined) =>
    eventsFrom([said('one'), replied('two'), said('three'), shellStarted(description)])

  it('labels a shell by its description, else its collapsed command, and omits absent fields', () => {
    const named = planRewind({
      events: shellEvents('run the tests'),
      toSeq: 1,
      roster: null,
      threadId: 'thr_1',
    })
    const bare = planRewind({
      events: shellEvents(undefined),
      toSeq: 1,
      roster: null,
      threadId: 'thr_1',
    })
    if (named.kind !== 'ok' || bare.kind !== 'ok') throw new Error('expected plans')
    expect(named.kills[0]?.label).toBe('run the tests')
    expect(bare.kills[0]?.label).toBe('npm test')
    expect(bare.cuts[0]).toEqual({ kind: 'shell', shellId: 'bash_1', command: 'npm   test' })
  })

  it('reads shell liveness only from this thread’s shells', () => {
    const own = planRewind({
      events: shellEvents(undefined),
      toSeq: 1,
      roster: shellRoster('thr_1'),
      threadId: 'thr_1',
    })
    const child = planRewind({
      events: shellEvents(undefined),
      toSeq: 1,
      roster: shellRoster('thr_child'),
      threadId: 'thr_1',
    })
    if (own.kind !== 'ok' || child.kind !== 'ok') throw new Error('expected plans')
    expect(own.kills[0]?.running).toBe(true)
    expect(child.kills[0]?.running).toBe(false)
  })
})
