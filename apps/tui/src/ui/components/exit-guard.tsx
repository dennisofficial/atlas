import React from 'react'

import {
  EXIT_GUARD_OPTIONS,
  type EExitChoice,
  type ExitGuardRow,
  type ExitGuardState,
} from '../exit-guard-model'
import { StopGuard, STOP_GUARD_INSET, stopGuardCells } from './stop-guard'

export const EXIT_GUARD_INSET = STOP_GUARD_INSET

export const exitGuardCells = stopGuardCells

export const HEADING = 'Background work is running'

export const SUBTITLE = 'The following will stop when you exit:'

export function ExitGuard(props: {
  width: number
  running: readonly ExitGuardRow[]
  state: ExitGuardState
  overlay?: boolean
  onPick: (choice: EExitChoice) => void
  onDismiss: () => void
}): React.ReactNode {
  return (
    <StopGuard
      width={props.width}
      heading={HEADING}
      subtitle={SUBTITLE}
      running={props.running}
      options={EXIT_GUARD_OPTIONS}
      state={props.state}
      {...(props.overlay === undefined ? {} : { overlay: props.overlay })}
      onPick={(choice) => props.onPick(choice as EExitChoice)}
      onDismiss={props.onDismiss}
    />
  )
}
