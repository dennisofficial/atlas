import { randomUUID } from 'node:crypto'
import { outstandingApproval, type EventLogPort, type ThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply, RosterWire } from '@dltech/atlas-wire'

import type { DeltaChannel } from '../channel/delta-channel'
import type { TurnOutcome } from '../loop/turn-outcome'
import type { OperatorInputPort } from '../operator-input/port'
import { backgroundRunning } from './binding'
import { SessionActivityPort } from './port'
import { activityOutcomeOf, createActivityTracker } from './state'
import type { ActivityReport, ActivityTracker } from './types'
import { currentWaiting } from './waiting'

type ThreadActivity = {
  revision: number
  turnEpoch: number
  finalizing: number
  observedOutcome: ReadActivityReply['observedOutcome']
  report: ActivityReport
  tracker: ActivityTracker
  detach: () => void
}

type RuntimeActivityDeps = {
  runtimeId?: string
  log: Pick<EventLogPort, 'refresh' | 'readOwn'>
  input: Pick<OperatorInputPort, 'pending'>
  channel: Pick<DeltaChannel, 'subscribe'>
  roster: {
    read(args: { threadId: ThreadId }): Promise<Pick<RosterWire, 'agents' | 'shells'>>
    subscribe(listener: () => void): () => void
  }
}

export class RuntimeSessionActivity extends SessionActivityPort {
  readonly runtimeId: string
  private readonly threads = new Map<ThreadId, ThreadActivity>()
  private readonly detachRoster: () => void
  private closed = false

  constructor(private readonly deps: RuntimeActivityDeps) {
    super()
    this.runtimeId = deps.runtimeId ?? randomUUID()
    this.detachRoster = deps.roster.subscribe(() => {
      for (const state of this.threads.values()) state.revision += 1
    })
  }

  private state(threadId: ThreadId): ThreadActivity {
    if (this.closed) throw new Error('Activity runtime is closed')
    const held = this.threads.get(threadId)
    if (held !== undefined) return held
    const state: ThreadActivity = {
      revision: 0,
      turnEpoch: 0,
      finalizing: 0,
      observedOutcome: null,
      report: { working: false, awaiting: null },
      tracker: createActivityTracker({
        report: (report) => {
          state.report = report
        },
      }),
      detach: () => {},
    }
    state.detach = this.deps.channel.subscribe({
      threadId,
      listener: (signal) => {
        if (
          signal.type === 'operator-input' ||
          signal.type === 'events-appended' ||
          signal.type === 'step-ended'
        ) {
          state.revision += 1
        }
      },
    })
    this.threads.set(threadId, state)
    return state
  }

  turnStarted({ threadId }: { threadId: ThreadId }): void {
    if (this.closed) return
    const state = this.state(threadId)
    state.revision += 1
    state.turnEpoch += 1
    state.observedOutcome = null
    state.tracker.turnStarted()
  }

  turnOutcome({ threadId, outcome }: { threadId: ThreadId; outcome: TurnOutcome }): void {
    if (this.closed) return
    const state = this.state(threadId)
    state.revision += 1
    const terminal = activityOutcomeOf(outcome)
    state.observedOutcome =
      terminal === undefined
        ? null
        : {
            identity: { kind: 'run', runId: outcome.runId },
            outcome: terminal,
          }
    state.tracker.turnOutcome(outcome)
  }

  turnFailed({ threadId }: { threadId: ThreadId }): void {
    if (this.closed) return
    const state = this.state(threadId)
    if (state.observedOutcome?.identity.kind === 'driver-failure') return
    state.revision += 1
    state.observedOutcome = {
      identity: { kind: 'driver-failure', runtimeId: this.runtimeId, revision: state.revision },
      outcome: 'failed',
    }
    state.tracker.turnFailed()
  }

  turnEnded({ threadId }: { threadId: ThreadId }): void {
    if (this.closed) return
    const state = this.state(threadId)
    state.revision += 1
    state.tracker.turnEnded()
  }

  holdFinalization({ threadId }: { threadId: ThreadId }): () => void {
    if (this.closed) return () => {}
    const state = this.state(threadId)
    state.finalizing += 1
    state.revision += 1
    let held = true
    return () => {
      if (!held || this.closed) return
      held = false
      state.finalizing -= 1
      state.revision += 1
    }
  }

  async read({ threadId }: { threadId: ThreadId }): Promise<ReadActivityReply> {
    const state = this.state(threadId)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const revision = state.revision
      await this.deps.log.refresh({ threadId })
      const events = await this.deps.log.readOwn({ threadId })
      const roster = await this.deps.roster.read({ threadId })
      const input = this.deps.input.pending({ threadId })
      if (this.closed) throw new Error('Activity runtime is closed')
      if (revision !== state.revision) continue
      const previous = state.report
      state.tracker.setApproval(outstandingApproval(events) !== undefined)
      state.tracker.setInput(input !== null)
      state.tracker.setBackground(backgroundRunning(roster) || state.finalizing > 0)
      state.tracker.setWaiting(currentWaiting(events))
      if (
        previous.working !== state.report.working ||
        previous.awaiting !== state.report.awaiting ||
        previous.waitingForModel !== state.report.waitingForModel
      )
        state.revision += 1
      return {
        runtimeId: this.runtimeId,
        revision: state.revision,
        turnEpoch: state.turnEpoch,
        working: state.report.working,
        awaiting: state.report.awaiting,
        observedOutcome: state.observedOutcome,
        ...(state.report.waitingForModel === undefined
          ? {}
          : { waitingForModel: state.report.waitingForModel }),
      }
    }
    throw new Error('Activity changed while reading')
  }

  close(): void {
    this.closed = true
    this.detachRoster()
    for (const state of this.threads.values()) state.detach()
    this.threads.clear()
  }
}

export type ActivityLifecycle = Pick<
  RuntimeSessionActivity,
  'turnStarted' | 'turnOutcome' | 'turnFailed' | 'turnEnded'
>
