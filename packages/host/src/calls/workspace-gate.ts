import type { PrepareResult } from '../holder/ports'

export type WorkspaceGateOutcome =
  | { state: 'prepared' }
  | { state: 'failed'; message: string }
  | { state: 'aborted' }

export type WorkspaceGateSettled = 'pending' | 'prepared' | 'failed'

const ABORTED = Symbol('aborted')

type Raced = PrepareResult | typeof ABORTED

const raceAbort = (args: {
  attempt: Promise<PrepareResult>
  signal: AbortSignal | undefined
}): Promise<Raced> => {
  const { signal } = args
  if (signal === undefined) return args.attempt
  if (signal.aborted) return Promise.resolve(ABORTED)
  return new Promise<Raced>((resolve, reject) => {
    const onAbort = (): void => resolve(ABORTED)
    signal.addEventListener('abort', onAbort, { once: true })
    void args.attempt.then(
      (outcome) => {
        signal.removeEventListener('abort', onAbort)
        resolve(outcome)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export class WorkspaceGate {
  private attempt: Promise<PrepareResult> = Promise.resolve({ ok: true })
  private phase: WorkspaceGateSettled = 'prepared'
  private waiting = 0
  private holds: Promise<void> = Promise.resolve()

  get blocked(): boolean {
    return this.waiting > 0
  }

  get settled(): WorkspaceGateSettled {
    return this.phase
  }

  arm(attempt: Promise<PrepareResult>): void {
    this.attempt = attempt
    this.phase = 'pending'
    void attempt.then(
      (outcome) => {
        this.phase = outcome.ok ? 'prepared' : 'failed'
      },
      () => {
        this.phase = 'failed'
      },
    )
  }

  hold(until: Promise<void>): void {
    const settled = until.catch(() => undefined)
    this.holds = Promise.all([this.holds, settled]).then(() => undefined)
  }

  async wait(signal?: AbortSignal | undefined): Promise<WorkspaceGateOutcome> {
    this.waiting += 1
    try {
      const outcome = await raceAbort({ attempt: this.attempt, signal })
      if (outcome === ABORTED) return { state: 'aborted' }
      if (!outcome.ok) {
        return { state: 'failed', message: `the workspace failed to prepare: ${outcome.reason}` }
      }
      const held = await raceAbort({
        attempt: this.holds.then((): PrepareResult => ({ ok: true })),
        signal,
      })
      return held === ABORTED ? { state: 'aborted' } : { state: 'prepared' }
    } finally {
      this.waiting -= 1
    }
  }
}
