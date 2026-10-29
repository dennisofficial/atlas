export const RESTART_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000]
export const CRASH_WINDOW_MS = 120_000
export const MAX_CRASHES_IN_WINDOW = 5

export enum ERestartVerdict {
  Restart = 'restart',
  GiveUp = 'give-up',
}

export type RestartVerdict =
  | { verdict: ERestartVerdict.Restart; delayMs: number; crashes: number }
  | { verdict: ERestartVerdict.GiveUp; crashes: number }

export function restartVerdict({
  crashTimes,
  nowMs,
}: {
  crashTimes: readonly number[]
  nowMs: number
}): RestartVerdict {
  const recent = crashTimes.filter((at) => nowMs - at < CRASH_WINDOW_MS)
  if (recent.length > MAX_CRASHES_IN_WINDOW) {
    return { verdict: ERestartVerdict.GiveUp, crashes: recent.length }
  }

  const last = RESTART_BACKOFF_MS[RESTART_BACKOFF_MS.length - 1] ?? 0
  const delayMs = RESTART_BACKOFF_MS[recent.length - 1] ?? last
  return { verdict: ERestartVerdict.Restart, delayMs, crashes: recent.length }
}

export type Scheduler = (args: { ms: number; run: () => void }) => () => void

export const timerScheduler: Scheduler = ({ ms, run }) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

export class ServiceSupervisor {
  private suspended = false
  private readonly gaveUp = new Set<string>()
  private readonly crashes = new Map<string, number[]>()
  private readonly pending = new Map<string, () => void>()
  private readonly scheduler: Scheduler

  constructor(args?: { scheduler?: Scheduler | undefined }) {
    this.scheduler = args?.scheduler ?? timerScheduler
  }

  recordCrash({ name, nowMs }: { name: string; nowMs: number }): RestartVerdict | undefined {
    if (this.suspended) return undefined

    const times = [...(this.crashes.get(name) ?? []), nowMs]
    this.crashes.set(name, times)
    const verdict = restartVerdict({ crashTimes: times, nowMs })
    if (verdict.verdict === ERestartVerdict.GiveUp) this.gaveUp.add(name)
    return verdict
  }

  crashLooping(name: string): boolean {
    return this.gaveUp.has(name)
  }

  restartAfter({ name, delayMs, run }: { name: string; delayMs: number; run: () => void }): void {
    this.cancel(name)
    const cancel = this.scheduler({
      ms: delayMs,
      run: () => {
        this.pending.delete(name)
        run()
      },
    })
    this.pending.set(name, cancel)
  }

  isPending(name: string): boolean {
    return this.pending.has(name)
  }

  cancel(name: string): void {
    this.pending.get(name)?.()
    this.pending.delete(name)
  }

  forget(name: string): void {
    this.cancel(name)
    this.crashes.delete(name)
    this.gaveUp.delete(name)
  }

  suspend(): void {
    this.suspended = true
    for (const name of [...this.pending.keys()]) this.cancel(name)
  }

  resume(): void {
    this.suspended = false
  }
}
