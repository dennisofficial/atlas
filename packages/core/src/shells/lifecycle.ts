import type { Event, EventOfType } from '../events/envelope'

export enum EShellLifecycleState {
  Open = 'open',
  Settled = 'settled',
  Lost = 'lost',
}

type StartedShell = EventOfType<'background-shell-started'>
type EndedShell = EventOfType<'background-shell-ended'>

export type ShellLifecycle = {
  shellId: string
  command: string
  description?: string | undefined
  bootId?: string | undefined
  started: StartedShell
  state: EShellLifecycleState
  ending?: EndedShell | undefined
}

const NO_BOOT = ''

/**
 * The pairing key for a shell: its boot identity scoped by its id. A start and an end pair only when
 * they share this key, so a shellId recycled across processes never lets one boot's end settle
 * another boot's open start. Events written before bootId existed carry none and share the empty
 * key, which is the old id-only behaviour for exactly the old data it described.
 */
export const shellKey = (shell: { shellId: string; bootId?: string | undefined }): string =>
  `${shell.bootId ?? NO_BOOT}${shell.shellId}`

/**
 * The one module that decides how a background shell's starts and ends pair, and therefore which
 * shells still need an end written. Recovery, teardown, and the transcript each used to scan the log
 * with a private rule for "settled", and the rules disagreed; the decision reads only the event
 * stream, so it lives here and the three callers become projections over this one structure.
 * Pairing is keyed on (bootId, shellId): ids recycle across boots (bash_1 restarts every launch), so
 * an id alone cannot tell a fresh shell from a stale start an earlier launch left open. A start and
 * an end pair only when they share a bootId, so a recycled id under a new boot never settles a
 * previous boot's open start; events that predate bootId fall back to id-only FIFO.
 */
export function shellsLifecycle(events: readonly Event[]): ShellLifecycle[] {
  const lifecycles: ShellLifecycle[] = []
  const openByKey = new Map<string, ShellLifecycle[]>()

  const enqueue = (started: StartedShell): void => {
    const lifecycle: ShellLifecycle = {
      shellId: started.shellId,
      command: started.command,
      description: started.description,
      bootId: started.bootId,
      started,
      state: EShellLifecycleState.Open,
    }
    lifecycles.push(lifecycle)

    const key = shellKey(started)
    const queue = openByKey.get(key) ?? []
    queue.push(lifecycle)
    openByKey.set(key, queue)
  }

  const settle = (ended: EndedShell): void => {
    const key = shellKey(ended)
    const queue = openByKey.get(key)
    const open = queue?.shift()
    if (queue !== undefined && queue.length === 0) openByKey.delete(key)
    if (open === undefined) return
    open.state = EShellLifecycleState.Settled
    open.ending = ended
  }

  for (const event of events) {
    if (event.type === 'background-shell-started') enqueue(event)
    if (event.type === 'background-shell-ended') settle(event)
  }

  for (const lifecycle of lifecycles) {
    if (lifecycle.state === EShellLifecycleState.Open) {
      lifecycle.state = EShellLifecycleState.Lost
    }
  }

  return lifecycles
}

/** The shells whose start has no end: a crash or a kill the log never settled. */
export const lostShellsOf = (events: readonly Event[]): ShellLifecycle[] =>
  shellsLifecycle(events).filter(
    (lifecycle) => lifecycle.state === EShellLifecycleState.Lost,
  )

/**
 * The pairing keys of every recorded end, for teardown's "already recorded" check. An end counts
 * even when its start is not in the log — the model-killed case, where the drain wrote an end for a
 * shell whose start a compaction dropped — so this reads the raw end events rather than the paired
 * lifecycles, which an orphan end never enters.
 */
export const endedShellKeysOf = (events: readonly Event[]): ReadonlySet<string> => {
  const ended = new Set<string>()
  for (const event of events) {
    if (event.type === 'background-shell-ended') ended.add(shellKey(event))
  }
  return ended
}

export const openShellIdsOf = (events: readonly Event[]): ReadonlySet<string> =>
  new Set(lostShellsOf(events).map((lifecycle) => lifecycle.shellId))
