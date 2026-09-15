import React from 'react'

import type { EExecutionLocation } from '@dltech/atlas-core'

import {
  CONTAINER_GUARD_OPTIONS,
  CONTAINER_GUARD_SUBTITLE,
  containerGuardHeading,
  type EContainerGuardChoice,
} from '../container-guard-model'
import type { StopGuardRow, StopGuardState } from '../stop-guard-model'
import { StopGuard } from './stop-guard'

export function ContainerGuard(props: {
  width: number
  target: EExecutionLocation
  running: readonly StopGuardRow[]
  state: StopGuardState
  overlay?: boolean
  onPick: (choice: EContainerGuardChoice) => void
  onDismiss: () => void
}): React.ReactNode {
  return (
    <StopGuard
      width={props.width}
      heading={containerGuardHeading(props.target)}
      subtitle={CONTAINER_GUARD_SUBTITLE}
      running={props.running}
      options={CONTAINER_GUARD_OPTIONS}
      state={props.state}
      {...(props.overlay === undefined ? {} : { overlay: props.overlay })}
      onPick={(choice) => props.onPick(choice as EContainerGuardChoice)}
      onDismiss={props.onDismiss}
    />
  )
}
