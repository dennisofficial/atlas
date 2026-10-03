import type { Event, EventOfType } from '../events/envelope'
import type { EventId } from '../events/ids'
import type { Lifecycle, LifecycleKind } from '../lifecycle/lifecycle'
import { endedKeysOf, ELifecycleState, lifecycleOf } from '../lifecycle/lifecycle'

export enum EShellLifecycleState {
  Open = ELifecycleState.Open,
  Settled = ELifecycleState.Settled,
  Lost = ELifecycleState.Lost,
}

type StartedShell = EventOfType<'background-shell-started'>
type EndedShell = EventOfType<'background-shell-ended'>

const NO_BOOT = ''

export const shellKey = (shell: { shellId: string; bootId?: string | undefined }): string =>
  `${shell.bootId ?? NO_BOOT}${shell.shellId}`

const shellLifecycleKind: LifecycleKind<StartedShell, EndedShell> = {
  isStart: (event): event is StartedShell => event.type === 'background-shell-started',
  isEnd: (event): event is EndedShell => event.type === 'background-shell-ended',
  keyOf: (event) => event.shellId,
  scopeOf: (event) => event.bootId ?? NO_BOOT,
}

export type ShellLifecycle = {
  shellId: string
  command: string
  description?: string | undefined
  bootId?: string | undefined
  started: StartedShell
  state: EShellLifecycleState
  ending?: EndedShell | undefined
}

const projectShell = (lifecycle: Lifecycle<StartedShell, EndedShell>): ShellLifecycle => {
  const started = lifecycle.started
  const shell: ShellLifecycle = {
    shellId: started.shellId,
    command: started.command,
    started,
    state: lifecycle.state as unknown as EShellLifecycleState,
    ...(started.description === undefined ? {} : { description: started.description }),
    ...(started.bootId === undefined ? {} : { bootId: started.bootId }),
  }
  if (lifecycle.ending !== undefined) shell.ending = lifecycle.ending
  return shell
}

export function shellsLifecycle(events: readonly Event[]): ShellLifecycle[] {
  return lifecycleOf(events, shellLifecycleKind).map(projectShell)
}

export const lostShellsOf = (events: readonly Event[]): ShellLifecycle[] =>
  shellsLifecycle(events).filter(
    (lifecycle) => lifecycle.state === EShellLifecycleState.Lost,
  )

export const endedShellKeysOf = (events: readonly Event[]): ReadonlySet<string> =>
  endedKeysOf(events, shellLifecycleKind)

export const openShellIdsOf = (events: readonly Event[]): ReadonlySet<string> =>
  new Set(lostShellsOf(events).map((lifecycle) => lifecycle.shellId))

export type ShellEventContext = {
  started?: StartedShell | undefined
  endedBefore?: EndedShell | undefined
}

type ShellNotice =
  | EventOfType<'background-shell-ended'>
  | EventOfType<'background-shell-matched'>
  | EventOfType<'background-shell-awaiting-input'>
  | EventOfType<'background-shell-still-running'>

const isShellNotice = (event: Event): event is ShellNotice =>
  event.type === 'background-shell-ended' ||
  event.type === 'background-shell-matched' ||
  event.type === 'background-shell-awaiting-input' ||
  event.type === 'background-shell-still-running'

const progressBootOf = (event: Exclude<ShellNotice, EndedShell>): string | undefined =>
  event.type === 'background-shell-still-running' ? undefined : event.bootId

export function shellEventContextsOf(events: readonly Event[]): ReadonlyMap<EventId, ShellEventContext> {
  const lifecycles = shellsLifecycle(events)
  const lifecycleByStart = new Map(lifecycles.map((lifecycle) => [lifecycle.started.id, lifecycle]))
  const lifecycleByEnding = new Map(
    lifecycles.flatMap((lifecycle) => (lifecycle.ending === undefined ? [] : [[lifecycle.ending.id, lifecycle] as const])),
  )

  const startsByShell = new Map<string, StartedShell[]>()
  const seenEndings = new Set<EventId>()
  const orphanEndings = new Map<string, EndedShell[]>()
  const contexts = new Map<EventId, ShellEventContext>()

  for (const event of events) {
    if (event.type === 'background-shell-started') {
      startsByShell.set(event.shellId, [...(startsByShell.get(event.shellId) ?? []), event])
      continue
    }

    if (!isShellNotice(event)) continue

    if (event.type === 'background-shell-ended') {
      seenEndings.add(event.id)
      const paired = lifecycleByEnding.get(event.id)
      if (paired === undefined) orphanEndings.set(event.shellId, [...(orphanEndings.get(event.shellId) ?? []), event])
      contexts.set(event.id, { started: paired?.started })
      continue
    }

    const bootId = progressBootOf(event)
    const started = (startsByShell.get(event.shellId) ?? []).findLast(
      (start) => bootId === undefined || start.bootId === bootId,
    )

    if (started === undefined) {
      const orphan = (orphanEndings.get(event.shellId) ?? []).findLast(
        (ending) => bootId === undefined || ending.bootId === undefined || ending.bootId === bootId,
      )
      contexts.set(event.id, { endedBefore: orphan })
      continue
    }

    const ending = lifecycleByStart.get(started.id)?.ending
    contexts.set(event.id, {
      started,
      endedBefore: ending !== undefined && seenEndings.has(ending.id) ? ending : undefined,
    })
  }

  return contexts
}
