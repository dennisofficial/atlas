import type { Event, EventOfType } from '../events/envelope'
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
