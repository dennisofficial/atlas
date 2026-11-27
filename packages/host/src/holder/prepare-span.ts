import { EWorkspaceStepState, type ThreadId, type WorkspaceStepReport } from '@dltech/atlas-core'
import {
  EPrepareOutcome,
  type EPreparePhase,
  ESandboxStart,
  ESpan,
  spanWith,
  type SpanFields,
  type TracePort,
} from '@dltech/atlas-observability'

export class PrepareSpan {
  private stopped = false
  private attemptStartedAt: number | undefined
  private lastClosedAt: number | undefined
  private readonly started = new Map<string, number>()
  private readonly stepMs: Record<string, number> = {}
  private readonly phaseMs: Record<string, number> = {}
  private workMs: Readonly<Record<string, number>> = {}

  constructor(
    private readonly args: {
      trace: TracePort | undefined
      sessionId: string
      threadId: ThreadId
      attempt: number | undefined
      preparedBefore: boolean
      promptWaiting: boolean | undefined
      now(): number
    },
  ) {}

  step(report: WorkspaceStepReport, producedAtMs?: number): void {
    const at = producedAtMs ?? this.args.now()
    this.attemptStartedAt ??= at
    if (report.state === EWorkspaceStepState.Started) {
      if (!this.started.has(report.step)) this.started.set(report.step, at)
      return
    }
    const startedAt = this.started.get(report.step)
    if (startedAt === undefined) {
      this.stepMs[report.step] = Math.max(0, at - (this.lastClosedAt ?? at))
    } else {
      this.started.delete(report.step)
      this.stepMs[report.step] = Math.max(0, at - startedAt)
    }
    this.lastClosedAt = at
  }

  phase(name: EPreparePhase): () => void {
    const startedAt = this.args.now()
    return () => {
      this.phaseMs[name] = Math.max(0, this.args.now() - startedAt)
    }
  }

  work(timings: Readonly<Record<string, number>> | undefined): void {
    if (timings === undefined) return
    this.workMs = { ...this.workMs, ...timings }
  }

  markStopped(): void {
    this.stopped = true
  }

  begin(run: () => Promise<{ failed: boolean }>): Promise<{ failed: boolean }> {
    return spanWith(this.args.trace, {
      name: ESpan.Prepare,
      root: true,
      fields: this.fieldsOf(),
      run: async (span) => {
        const outcome = await run()
        span.set({ outcome: this.outcomeOf(outcome.failed), timings: this.timingsOf() })
        return outcome
      },
    })
  }

  private timingsOf(): Record<string, number> {
    const from = this.attemptStartedAt ?? this.args.now()
    return {
      ...this.workMs,
      ...this.stepMs,
      ...this.phaseMs,
      prepare: Math.max(0, this.args.now() - from),
    }
  }

  private outcomeOf(failed: boolean): EPrepareOutcome {
    if (this.stopped) return EPrepareOutcome.Stopped
    return failed ? EPrepareOutcome.Failed : EPrepareOutcome.Prepared
  }

  private fieldsOf(): SpanFields {
    const { attempt, preparedBefore, promptWaiting } = this.args
    return {
      sessionId: this.args.sessionId,
      threadId: this.args.threadId,
      sandbox: ESandboxStart.Unknown,
      preparedBefore,
      ...(attempt === undefined ? {} : { attempt }),
      ...(promptWaiting === undefined ? {} : { promptWaiting }),
    }
  }
}
