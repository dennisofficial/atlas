import React from 'react'

import type {
  EExitChoice,
  ExitGuardOption,
  ExitGuardRow,
  ExitGuardState,
} from '../exit-guard-model'
import { StopGuard, STOP_GUARD_INSET, stopGuardCells } from './stop-guard'

export const EXIT_GUARD_INSET = STOP_GUARD_INSET

export const exitGuardCells = stopGuardCells

export const HEADING = 'Background work is running'

export const SUBTITLE = 'The following will stop when you exit:'

export const CLOUD_HEADING = 'Leave the cloud session?'

export const CLOUD_SUBTITLE =
  'The turn keeps running; the filesystem persists via snapshot; services die on park.'

export const CLOUD_SUBTITLE_WITH_TASKS =
  'Only these stop when you exit; the cloud session keeps running.'

export function ExitGuard(props: {
  width: number
  running: readonly ExitGuardRow[]
  options: readonly ExitGuardOption[]
  cloud: boolean
  state: ExitGuardState
  overlay?: boolean
  onPick: (choice: EExitChoice) => void
  onDismiss: () => void
}): React.ReactNode {
  const heading = props.cloud ? CLOUD_HEADING : HEADING
  const subtitle = props.cloud
    ? props.running.length === 0
      ? CLOUD_SUBTITLE
      : CLOUD_SUBTITLE_WITH_TASKS
    : SUBTITLE

  return (
    <StopGuard
      width={props.width}
      heading={heading}
      subtitle={subtitle}
      running={props.running}
      options={props.options}
      state={props.state}
      {...(props.overlay === undefined ? {} : { overlay: props.overlay })}
      onPick={(choice) => props.onPick(choice as EExitChoice)}
      onDismiss={props.onDismiss}
    />
  )
}
