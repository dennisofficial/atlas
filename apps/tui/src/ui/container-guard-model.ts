import { EExecutionLocation } from '@dltech/atlas-core'

import {
  openStopGuard,
  type StopGuardOption,
  type StopGuardState,
} from './stop-guard-model'

export enum EContainerGuardChoice {
  SwitchAndStop = 'switch-and-stop',
  Stay = 'stay',
}

export const CONTAINER_GUARD_OPTIONS: readonly StopGuardOption<EContainerGuardChoice>[] =
  Object.freeze([
    { choice: EContainerGuardChoice.SwitchAndStop, label: 'Switch and stop tasks', enabled: true },
    { choice: EContainerGuardChoice.Stay, label: 'Stay', enabled: true },
  ])

export function openContainerGuard(): StopGuardState {
  return openStopGuard({ options: CONTAINER_GUARD_OPTIONS })
}

export function containerGuardHeading(target: EExecutionLocation): string {
  if (target === EExecutionLocation.Docker) return 'Moving this conversation into a container'
  if (target === EExecutionLocation.Cloud) return 'Moving this conversation to the cloud'

  return 'Moving this conversation back to the host'
}

export const CONTAINER_GUARD_SUBTITLE = 'The following will be stopped for the switch:'
