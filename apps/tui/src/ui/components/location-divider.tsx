import React from 'react'

import { EExecutionLocation, ELocationChangeCause } from '@dltech/atlas-core'

import { theme, TRANSCRIPT_INSET } from '../theme'

const causeLabelOf = (cause: ELocationChangeCause | undefined): string => {
  if (cause === ELocationChangeCause.SandboxExpired) return ' — sandbox expired'

  return ''
}

const labelOf = (args: {
  location: EExecutionLocation
  cause?: ELocationChangeCause | undefined
}): string => {
  const place =
    args.location === EExecutionLocation.Docker
      ? 'docker container'
      : args.location === EExecutionLocation.Cloud
        ? 'cloud sandbox'
        : 'host'
  return ` ${place}${causeLabelOf(args.cause)} `
}

const STUB = 4

export function LocationDivider(props: {
  width: number
  location: EExecutionLocation
  cause?: ELocationChangeCause | undefined
}): React.ReactNode {
  const label = labelOf({ location: props.location, cause: props.cause })
  const total = Math.max(label.length + STUB * 2, props.width - TRANSCRIPT_INSET)
  const left = Math.max(STUB, Math.floor((total - label.length) / 2))
  const right = Math.max(STUB, total - label.length - left)

  return (
    <box flexDirection="row" marginTop={1} marginBottom={1}>
      <text fg={theme.meta}>
        {'─'.repeat(left)}
        {label}
        {'─'.repeat(right)}
      </text>
    </box>
  )
}
