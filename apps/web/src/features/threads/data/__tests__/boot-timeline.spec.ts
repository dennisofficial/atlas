import { describe, expect, it } from 'bun:test'

import {
  EBootStep,
  EBootStepState,
  EPodState,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire/web'

import { bootTimelineOf, EBootEntryKind } from '../boot-timeline'
import { ETranscriptKind, type TranscriptItem } from '../transcript-items'
import { turnsOf } from '../transcript-turns'

const T0 = Date.parse('2026-10-24T10:00:00.000Z')
const isoAt = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

const ALL_STEPS = [
  EBootStep.Provision,
  EBootStep.Serve,
  EBootStep.Clone,
  EBootStep.Context,
  EBootStep.Settings,
  EBootStep.Agent,
]

const bootAt = (offsetMs: number): RecordedBootStep[] =>
  ALL_STEPS.flatMap((step, index) => [
    { step, state: EBootStepState.Running, at: isoAt(offsetMs + index * 200) },
    {
      step,
      state: EBootStepState.Done,
      at: isoAt(offsetMs + index * 200 + 100),
    },
  ])

const startingAt = (offsetMs: number): RecordedBootStep[] => [
  {
    step: EBootStep.Provision,
    state: EBootStepState.Running,
    at: isoAt(offsetMs),
  },
]

const user = (id: string, offsetMs: number): TranscriptItem => ({
  kind: ETranscriptKind.User,
  id,
  text: id,
  at: isoAt(offsetMs),
})

const agent = (id: string, offsetMs: number): TranscriptItem => ({
  kind: ETranscriptKind.Agent,
  id,
  text: id,
  streaming: false,
  at: isoAt(offsetMs),
})

const pod = (state: EPodState, history: RecordedBootStep[], steps = history): PodStatus => ({
  state,
  steps,
  history,
})

const timelineOf = (items: TranscriptItem[], status: PodStatus) =>
  bootTimelineOf({
    turns: turnsOf({ items, working: false }),
    pod: status,
    now: T0 + 999_000,
  })

const shapeOf = (items: TranscriptItem[], status: PodStatus) =>
  timelineOf(items, status).map((entry) =>
    entry.kind === EBootEntryKind.Parked
      ? [entry.kind, entry.afterIndex]
      : [entry.kind, entry.afterIndex, entry.view.state, entry.live],
  )

const firstExchange = [user('u1', 0), agent('a1', 20_000)]

describe('bootTimelineOf', () => {
  it('is empty before the pod is known and for a pod that never started', () => {
    expect(bootTimelineOf({ turns: [], pod: null, now: T0 })).toEqual([])
    expect(timelineOf(firstExchange, pod(EPodState.None, []))).toEqual([])
  })

  it('places the first boot after the first message, ahead of its clock', () => {
    const history = bootAt(-50)
    expect(shapeOf(firstExchange, pod(EPodState.Running, history))).toEqual([
      [EBootEntryKind.Boot, 0, EBootStepState.Done, true],
    ])
  })

  it('adds a parked line after the last turn and keeps the first boot settled', () => {
    expect(shapeOf(firstExchange, pod(EPodState.Parked, bootAt(0)))).toEqual([
      [EBootEntryKind.Boot, 0, EBootStepState.Done, false],
      [EBootEntryKind.Parked, 1],
    ])
  })

  it('replaces the parked line with a new startup group after the message that woke it', () => {
    const items = [...firstExchange, user('u2', 60_000)]
    const resume = startingAt(60_010)
    const history = [...bootAt(0), ...resume]
    expect(shapeOf(items, pod(EPodState.Booting, history, resume))).toEqual([
      [EBootEntryKind.Boot, 0, EBootStepState.Done, false],
      [EBootEntryKind.Boot, 2, EBootStepState.Running, true],
    ])
  })

  it('keeps one startup group per message however often the pod parked and woke', () => {
    const items = [...firstExchange, user('u2', 60_000)]
    const latest = startingAt(90_000)
    const history = [...bootAt(0), ...bootAt(60_010), ...bootAt(70_000), ...latest]
    const entries = timelineOf(items, pod(EPodState.Booting, history, latest))
    expect(entries.map((entry) => entry.afterIndex)).toEqual([0, 2])
    expect(entries.at(-1)?.id).toBe(`sandbox-boot-${T0 + 90_000}`)
  })

  it('falls back to the latest attempt when the API sends no history', () => {
    const status: PodStatus = {
      state: EPodState.Booting,
      steps: startingAt(0),
    }
    expect(shapeOf(firstExchange, status)).toEqual([
      [EBootEntryKind.Boot, 0, EBootStepState.Running, true],
    ])
  })
})
