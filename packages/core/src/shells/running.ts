import type { RunningShell } from '../assembly/rules/running-shells-block'
import type { Event } from '../events/envelope'
import { ELifecycleState } from '../lifecycle/lifecycle'
import { shellsLifecycle } from './lifecycle'

export function runningShellsOf(events: readonly Event[]): readonly RunningShell[] {
  return shellsLifecycle(events)
    .filter((lifecycle) => lifecycle.state === ELifecycleState.Lost)
    .map((lifecycle) => ({
      shellId: lifecycle.started.shellId,
      command: lifecycle.started.command,
      ...(lifecycle.started.description === undefined
        ? {}
        : { description: lifecycle.started.description }),
      awaitingInput: false,
    }))
}
