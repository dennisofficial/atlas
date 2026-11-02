import { ECallError } from './call-states'

export enum ECallInvariant {
  SingleSpawnPerBoot = 'single-spawn-per-boot',
  DispatchedSettlesExactlyOnce = 'dispatched-settles-exactly-once',
  NoStaleEpochWrite = 'no-stale-epoch-write',
}

export type RecordWrite = {
  type: 'tool-dispatched' | 'tool-result' | 'tool-denied' | 'turn-failed'
  callId: string | undefined
  epoch: number
  committed: boolean
}

export type CallHistory = {
  errors: Readonly<Record<string, readonly ECallError[]>>
  spawns: Readonly<Record<string, readonly number[]>>
  readOnly: Readonly<Record<string, boolean>>
  writes: readonly RecordWrite[]
  keys: readonly string[]
  staleAtWrite: (write: RecordWrite) => boolean
}

const isResultLike = (write: RecordWrite): boolean =>
  write.type === 'tool-result' || write.type === 'tool-denied' || write.type === 'turn-failed'

const spawnedOncePerBoot = (history: CallHistory, key: string): boolean => {
  const spawns = history.spawns[key] ?? []
  const forgiven = (history.errors[key] ?? []).includes(ECallError.SpawnWithoutJournal)
  const perBoot = new Map<number, number>()
  for (const boot of spawns) perBoot.set(boot, (perBoot.get(boot) ?? 0) + 1)
  const boots = perBoot.size
  const repeatsInOneBoot = [...perBoot.values()].some((count) => count > 1)
  if (repeatsInOneBoot && !forgiven) return false
  return boots <= 1 || history.readOnly[key] === true
}

export function checkCallHistory(
  history: CallHistory,
  options: { final: boolean },
): ECallInvariant[] {
  const failures: ECallInvariant[] = []

  if (history.keys.some((key) => !spawnedOncePerBoot(history, key))) {
    failures.push(ECallInvariant.SingleSpawnPerBoot)
  }

  if (options.final) {
    const unsettled = history.keys.some((key) => {
      const committed = history.writes.filter((write) => write.callId === key && write.committed)
      const dispatched = committed.filter((write) => write.type === 'tool-dispatched').length
      const settled = committed.filter(isResultLike).length
      return dispatched > 0 && settled !== dispatched
    })
    if (unsettled) failures.push(ECallInvariant.DispatchedSettlesExactlyOnce)
  }

  const stale = history.writes.some((write) => write.committed && history.staleAtWrite(write))
  if (stale) failures.push(ECallInvariant.NoStaleEpochWrite)

  return failures
}
