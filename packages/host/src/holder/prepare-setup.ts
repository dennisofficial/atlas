import {
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  setupFinishedText,
  setupStartedText,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import { setupNoticesOf } from './prepare-notices'
import { elapsedMsOf, stoppedSetupDraftsOf } from './prepare-attempt'
import type { AppendBody } from './record/append-drafts'
import type { SessionRecord } from './record/record-adapter'
import type { SetupLifecycle } from './ports'

const appendFailureReporter =
  (deps: HeldSessionDeps, verb: string) =>
  (error: unknown): void =>
    deps.log?.error({
      source: 'holder.prepare',
      message: `${verb} of ${deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })

export class PrepareSetup {
  private running = false
  private joined = false
  private script: string | undefined
  private startedAt = 0
  private startedText: string | undefined
  private finished: { text: string; failed: boolean } | undefined

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      abandoned(): boolean
      settled(): boolean
      steps(): Promise<void>
      attempt(): number | undefined
      target(): { record: SessionRecord; threadId: ThreadId } | undefined
      onEnded(): void
    },
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  get isJoined(): boolean {
    return this.joined
  }

  start(args: { script: string | undefined; since: number; resuming: boolean }): void {
    this.startedText = undefined
    this.finished = undefined
    this.script = args.script
    this.startedAt = args.since
    this.running = args.resuming
    this.joined = args.resuming
  }

  onLifecycle(lifecycle: SetupLifecycle): void {
    if (this.args.abandoned()) return
    if (lifecycle.phase === ESetupPhase.Started) {
      this.script = lifecycle.script
      if (this.startedAt === 0) this.startedAt = this.args.deps.timers.now()
      const record = this.args.target()?.record
      if (record === undefined || !setupNoticesOf(record).has(ESetupPhase.Started)) {
        this.startedText = setupStartedText({ script: lifecycle.script })
      }
      this.running = true
      return
    }
    this.joined = false
    this.finished = {
      text: setupFinishedText({
        script: lifecycle.script,
        ok: lifecycle.ok,
        durationMs: Math.max(lifecycle.durationMs, this.elapsedMs()),
        output: lifecycle.output,
      }),
      failed: !lifecycle.ok,
    }
    void this.flushEnd()
  }

  async failStopped(): Promise<void> {
    const target = this.args.target()
    if (target === undefined || !this.running) return
    const script = this.script ?? ''
    this.running = false
    this.joined = false
    this.finished = undefined
    await target.record
      .append({
        threadId: target.threadId,
        runId: this.args.deps.ids.nextRunId(),
        drafts: stoppedSetupDraftsOf({
          script,
          attempt: this.args.attempt(),
          durationMs: this.elapsedMs(),
        }),
      })
      .catch(appendFailureReporter(this.args.deps, 'recording the stop of the setup'))
  }

  takeStarted(): EventDraft[] {
    const text = this.startedText
    if (text === undefined) return []
    this.startedText = undefined
    return [{ type: 'sandbox-setup-reported', text, failed: false, phase: ESetupPhase.Started }]
  }

  endLostSetup(reason: string): AppendBody[] {
    const attempt = this.args.attempt()
    this.joined = false
    if (!this.running) return []
    this.running = false
    return [
      {
        type: 'workspace-step',
        step: EWorkspaceStep.Setup,
        state: EWorkspaceStepState.Interrupted,
        reason: `the setup was lost when the workspace could not be prepared again: ${reason}`,
        ...(this.script === undefined ? {} : { command: this.script }),
        ...(attempt === undefined ? {} : { attempt }),
      },
    ]
  }

  private elapsedMs(): number {
    return elapsedMsOf({ startedAt: this.startedAt, nowMs: this.args.deps.timers.now() })
  }

  async flushEnd(): Promise<void> {
    const { finished, args } = this
    const target = args.target()
    if (finished === undefined || target === undefined || !args.settled()) return
    this.finished = undefined
    await args.steps()
    // a replayed lifecycle, or an end an earlier host already recorded, is reported once
    if (!args.abandoned() && !setupNoticesOf(target.record).has(ESetupPhase.Finished)) {
      await args.deps.plane
        .post({
          sessionId: args.deps.sessionId,
          kind: INBOX_KIND_EVENT,
          payload: inboxEventPayloadOf({
            event: {
              type: 'sandbox-setup-reported',
              text: finished.text,
              failed: finished.failed,
              phase: ESetupPhase.Finished,
            },
            clientId: `sandbox-setup-finished:${args.deps.sessionId}`,
          }),
        })
        .catch(appendFailureReporter(args.deps, 'recording the end of the setup'))
    }
    this.running = false
    args.onEnded()
  }
}
