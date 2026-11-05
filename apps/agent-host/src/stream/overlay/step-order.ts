import type { StreamStepKey } from '@dltech/atlas-protocol'

const MAX_REMEMBERED_RUNS = 16

export const sameStep = (a: StreamStepKey, b: StreamStepKey): boolean =>
  a.runId === b.runId && a.step === b.step && a.attempt === b.attempt

export const isAfter = (args: { candidate: StreamStepKey; current: StreamStepKey }): boolean => {
  const { candidate, current } = args
  if (candidate.runId !== current.runId) return true
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
    return !isAfter({ candidate: key, current: retired })
  }

  retire(key: StreamStepKey): void {
    const retired = this.runs.get(key.runId)
    if (retired === ALL) return
    if (retired !== undefined && !isAfter({ candidate: key, current: retired })) return
    this.remember({ runId: key.runId, value: key })
  }

  retireBefore(args: { previous: StreamStepKey; next: StreamStepKey }): void {
    if (args.previous.runId === args.next.runId) {
      this.retire(args.previous)
      return
    }
    this.remember({ runId: args.previous.runId, value: ALL })
  }

  private remember(args: { runId: string; value: StreamStepKey | typeof ALL }): void {
    this.runs.delete(args.runId)
    this.runs.set(args.runId, args.value)
    if (this.runs.size <= MAX_REMEMBERED_RUNS) return
    const oldest = this.runs.keys().next().value
    if (oldest !== undefined) this.runs.delete(oldest)
  }
}
