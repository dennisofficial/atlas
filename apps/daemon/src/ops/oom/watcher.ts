import { EOomScope } from '@dltech/atlas-core'
import type { DaemonEvent } from '@dltech/atlas-protocol'

import type { OomJournal } from './journal'
import { oomKillTotalOf, oomMemoryOf } from './memory'

export const POD_OOM_INTERVAL_MS = 2000
export const POD_OOM_GRACE_MS = 5000

type Env = Record<string, string | undefined>

export type PodOomWatcher = {
  claim(processes: number): void
  poll(): void
  start(): void
  stop(): void
}

export const podOomWatcherOf = (args: {
  env: Env
  journal: OomJournal
  publish: (event: DaemonEvent) => void
  intervalMs?: number | undefined
  graceMs?: number | undefined
  now?: (() => number) | undefined
}): PodOomWatcher => {
  const intervalMs = args.intervalMs ?? POD_OOM_INTERVAL_MS
  const graceMs = args.graceMs ?? POD_OOM_GRACE_MS
  const now = args.now ?? Date.now
  let last = oomKillTotalOf(args.env) ?? 0
  let accounted = 0
  let pending = 0
  let pendingSince: number | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const record = (processes: number): void => {
    const memory = oomMemoryOf(args.env)
    if (memory === null) return
    const incident = args.journal.record({ scope: EOomScope.Pod, processes, memory })
    args.publish({ type: 'pod.oom', incident })
  }

  const poll = (): void => {
    const current = oomKillTotalOf(args.env)
    if (current === null) return
    if (current > last) {
      pending += current - last
      if (pendingSince === null) pendingSince = now()
    }
    last = current
    const claimed = Math.min(accounted, pending)
    accounted -= claimed
    pending -= claimed
    if (pending <= 0) {
      pending = 0
      pendingSince = null
      return
    }
    if (now() - (pendingSince ?? now()) < graceMs) return
    const processes = pending
    pending = 0
    pendingSince = null
    record(processes)
  }

  const claim = (processes: number): void => {
    accounted += Math.max(0, processes)
  }

  const start = (): void => {
    if (timer !== null) return
    timer = setInterval(poll, intervalMs)
    timer.unref()
  }

  const stop = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  return { claim, poll, start, stop }
}
