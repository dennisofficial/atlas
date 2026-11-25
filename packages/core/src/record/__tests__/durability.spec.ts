import { describe, expect, it } from 'bun:test'

import { CORE_EVENT_TYPES } from '../../events/schema'
import { ECompactionAnchor } from '../../events/body'
import { ESetupPhase } from '../../workspace/setup-notice'
import { chainEvents } from '../chain-events'
import { RECORD_ONLY_TYPES, type RecordEventBody } from '../event'
import { DURABLE_TYPES, EVENT_DURABILITY, foldableOf, isDurable } from '../durability'
import { foldableEvents, visibleEvents } from '../visibility'
import { ETurnCause } from '../turns'
import { initialStatusFacts, stepStatusFacts } from '../views/status-facts'
import { EWorkspaceStep, EWorkspaceStepState } from '../workspace'
import { setupInFlightOf, workspaceStepsOf } from '../workspace-steps'
import { NOW, runId, threadId } from './support'

const log = (bodies: RecordEventBody[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const setupStarted: RecordEventBody = {
  type: 'workspace-step',
  step: EWorkspaceStep.Setup,
  state: EWorkspaceStepState.Started,
  command: 'bun install',
  attempt: 1,
}

const summarisedFrom = (fromSeq: number, throughSeq: number): RecordEventBody => ({
  type: 'history-summarised',
  fromSeq,
  throughSeq,
  anchor: ECompactionAnchor.Prefix,
  summary: 'earlier work',
})

const bootThenSummary = () =>
  log([
    { type: 'workspace-attempt-started', attempt: 1 },
    setupStarted,
    {
      type: 'sandbox-setup-reported',
      text: 'setup started',
      failed: false,
      phase: ESetupPhase.Started,
    },
    { type: 'workspace-prepared' },
    { type: 'user-said', text: 'go' },
    { ...setupStarted, state: EWorkspaceStepState.Done },
    {
      type: 'sandbox-setup-reported',
      text: 'setup finished',
      failed: false,
      phase: ESetupPhase.Finished,
    },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
    { type: 'user-said', text: 'next' },
    summarisedFrom(3, 8),
  ])

describe('durable events', () => {
  it('classifies every core and record event type', () => {
    const classified = new Set(Object.keys(EVENT_DURABILITY))
    const known = [...CORE_EVENT_TYPES, ...RECORD_ONLY_TYPES]
    expect(known.filter((type) => !classified.has(type))).toEqual([])
  })

  it('treats a plugin event as durable', () => {
    expect(isDurable('skills-changed')).toBe(true)
    expect(isDurable('user-said')).toBe(false)
  })

  it('keeps the holder answer to a withdraw durable', () => {
    expect(isDurable('input-withdrawn')).toBe(true)
    expect(isDurable('input-refused')).toBe(true)
  })

  it('keeps every lifecycle start and its ending durable together', () => {
    const pairs = [
      ['workspace-attempt-started', 'workspace-prepared'],
      ['turn-started', 'turn-ended'],
      ['background-shell-started', 'background-shell-ended'],
      ['agent-spawned', 'agent-ended'],
      ['service-started', 'service-ended'],
      ['subscription-created', 'subscription-ended'],
      ['model-waiting', 'model-wait-cleared'],
    ] as const
    for (const pair of pairs) expect(pair.every((type) => DURABLE_TYPES.includes(type))).toBe(true)
  })

  it('settles the setup a summary hid the ending of, while its rows stay hidden', () => {
    const events = bootThenSummary()
    const visible = visibleEvents(events)
    const foldable = foldableEvents(events)

    expect(setupInFlightOf(visible)).toBe(true)
    expect(setupInFlightOf(foldable)).toBe(false)
    expect(workspaceStepsOf(foldable)[EWorkspaceStep.Setup]?.state).toBe(EWorkspaceStepState.Done)
    expect(foldable.reduce(stepStatusFacts, initialStatusFacts).setupRun).toBeNull()
    expect(visible.some((event) => event.type === 'sandbox-setup-reported')).toBe(false)
    expect(foldable.some((event) => event.type === 'assistant-said')).toBe(false)
  })

  it('keeps durable events a rewind cut out foldable too', () => {
    const events = log([
      { type: 'user-said', text: 'go' },
      { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
      { type: 'assistant-said', parts: [] },
      { type: 'history-rewound', toSeq: 1 },
    ])
    expect(foldableEvents(events).map((event) => event.type)).toEqual(['user-said', 'turn-started'])
  })
})

describe('foldableOf', () => {
  it('merges the visible window with the durable log in seq order, once each', () => {
    const [a, b, c] = log([
      { type: 'user-said', text: 'a' },
      { type: 'turn-started', turnId: 't', cause: ETurnCause.Input },
      { type: 'user-said', text: 'c' },
    ])
    if (a === undefined || b === undefined || c === undefined) throw new Error('short log')
    expect(foldableOf({ visible: [a, c], durable: [b] }).map((event) => event.seq)).toEqual([
      1, 2, 3,
    ])
    expect(foldableOf({ visible: [b, c], durable: [b] })).toEqual([b, c])
  })
})
