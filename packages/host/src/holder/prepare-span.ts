import { EWorkspaceStepState, type ThreadId, type WorkspaceStepReport } from '@dltech/atlas-core'
import {
  EPrepareOutcome,
  ESandboxStart,
  ESpan,
  spanWith,
  type SpanFields,
  type TracePort,
} from '@dltech/atlas-observability'

export class PrepareSpan {
  private stopped = false
  private attemptStartedAt: number | undefined
  private readonly started = new Map<string, number>()
  private readonly stepMs: Record<string, number> = {}

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
      this.started.set(report.step, at)
      return
    }
    const startedAt = this.started.get(report.step)
    if (startedAt === undefined) return
    this.started.delete(report.step)
    this.stepMs[report.step] = Math.max(0, at - startedAt)
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
    return { ...this.stepMs, prepare: Math.max(0, this.args.now() - from) }
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
