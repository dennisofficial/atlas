import type { StreamStepKey } from '@dltech/atlas-protocol'

const MAX_REMEMBERED_RUNS = 16

export const sameStep = (args: { left: StreamStepKey; right: StreamStepKey }): boolean =>
  args.left.runId === args.right.runId &&
  args.left.step === args.right.step &&
  args.left.attempt === args.right.attempt

export const isLaterInRun = (args: {
  candidate: StreamStepKey
  current: StreamStepKey
}): boolean => {
  const { candidate, current } = args
  if (candidate.step !== current.step) return candidate.step > current.step
  return candidate.attempt > current.attempt
}

const ALL = 'all'

export class RetiredSteps {
  private readonly runs = new Map<string, StreamStepKey | typeof ALL>()

  has(key: StreamStepKey): boolean {
    const retired = this.runs.get(key.runId)
    if (retired === undefined) return false
    if (retired === ALL) return true
    return !isLaterInRun({ candidate: key, current: retired })
  }

  retire(key: StreamStepKey): void {
    const retired = this.runs.get(key.runId)
    if (retired === ALL) return
    if (retired !== undefined && !isLaterInRun({ candidate: key, current: retired })) return
    this.remember({ runId: key.runId, value: key })
  }

  retireRun(runId: string): void {
    this.remember({ runId, value: ALL })
  }

  retireSuperseded(args: { stale: StreamStepKey; latest: StreamStepKey }): void {
    const { stale, latest } = args
    if (sameStep({ left: stale, right: latest })) return
    if (stale.runId !== latest.runId) {
      this.retireRun(stale.runId)
      return
    }
    if (!isLaterInRun({ candidate: stale, current: latest })) this.retire(stale)
  }

  private remember(args: { runId: string; value: StreamStepKey | typeof ALL }): void {
    this.runs.delete(args.runId)
    this.runs.set(args.runId, args.value)
    if (this.runs.size <= MAX_REMEMBERED_RUNS) return
    const oldest = this.runs.keys().next().value
    if (oldest !== undefined) this.runs.delete(oldest)
  }
}
