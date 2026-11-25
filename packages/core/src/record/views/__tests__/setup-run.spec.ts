import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '../../../events/ids'
import { ESetupPhase } from '../../../workspace/setup-notice'
import { chainEvents } from '../../chain-events'
import type { RecordEventBody, RecordEvent } from '../../event'
import { EWorkspaceStep, EWorkspaceStepState } from '../../workspace'
import { initialStatusFacts, setupRunningOf, stepStatusFacts } from '../status-facts'

const FIRST_MS = Date.parse('2026-11-22T03:06:48.000Z')
const MINUTE_MS = 60_000

const setupStartedStep: RecordEventBody = {
  type: 'workspace-step',
  step: EWorkspaceStep.Setup,
  state: EWorkspaceStepState.Started,
  command: 'bun install',
}

const cloneStartedStep: RecordEventBody = {
  type: 'workspace-step',
  step: EWorkspaceStep.Clone,
  state: EWorkspaceStepState.Started,
}

const setupDoneStep: RecordEventBody = {
  type: 'workspace-step',
  step: EWorkspaceStep.Setup,
  state: EWorkspaceStepState.Done,
  command: 'bun install',
}

const startedReport: RecordEventBody = {
  type: 'sandbox-setup-reported',
  text: 'the project setup script started in the background',
  failed: false,
  phase: ESetupPhase.Started,
}

const finishedReport: RecordEventBody = {
  type: 'sandbox-setup-reported',
  text: 'the project setup script finished after 40s',
  failed: false,
  phase: ESetupPhase.Finished,
}

const warningReport: RecordEventBody = {
  type: 'sandbox-setup-reported',
  text: 'setup reported warnings',
  failed: true,
}

const eventsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    epoch: 1,
    at: new Date(FIRST_MS).toISOString(),
    bodies,
  }).map((event) => ({ ...event, at: new Date(FIRST_MS + event.seq * MINUTE_MS).toISOString() }))

const runningAt = (args: { events: readonly RecordEvent[]; minute: number }): boolean =>
  setupRunningOf({
    run: args.events.reduce(stepStatusFacts, initialStatusFacts).setupRun,
    now: new Date(FIRST_MS + args.minute * MINUTE_MS).toISOString(),
  })

describe('the setup script as a busy fact', () => {
  it('counts from the moment the setup step starts its script', () => {
    const events = eventsOf([setupStartedStep])
    expect(runningAt({ events, minute: 1 })).toBe(true)
  })

  it('counts a started report that has no end yet', () => {
    const events = eventsOf([setupStartedStep, startedReport])
    expect(runningAt({ events, minute: 5 })).toBe(true)
  })

  it('stops counting once the setup reports that it finished', () => {
    const events = eventsOf([setupStartedStep, startedReport, finishedReport])
    expect(runningAt({ events, minute: 5 })).toBe(false)
  })

  it('stops counting when the setup step ends without a report', () => {
    const events = eventsOf([setupStartedStep, startedReport, setupDoneStep])
    expect(runningAt({ events, minute: 5 })).toBe(false)
  })

  it('does not let a start from an earlier prepare attempt hold', () => {
    const events = eventsOf([
      setupStartedStep,
      startedReport,
      { type: 'workspace-attempt-started', attempt: 2 },
    ])
    expect(runningAt({ events, minute: 5 })).toBe(false)
  })

  it('does not let a start whose end never came hold past the run limit', () => {
    const events = eventsOf([setupStartedStep, startedReport])
    expect(runningAt({ events, minute: 20 })).toBe(true)
    expect(runningAt({ events, minute: 40 })).toBe(false)
  })

  it('keeps counting through a report that carries no phase', () => {
    const events = eventsOf([setupStartedStep, startedReport, warningReport])
    expect(runningAt({ events, minute: 5 })).toBe(true)
  })

  it('ignores the other workspace steps', () => {
    const events = eventsOf([cloneStartedStep])
    expect(runningAt({ events, minute: 1 })).toBe(false)
  })
})
