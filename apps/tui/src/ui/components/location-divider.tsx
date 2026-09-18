import React from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'

import { theme, TRANSCRIPT_INSET } from '../theme'

const labelOf = (location: EExecutionLocation): string => {
  if (location === EExecutionLocation.Docker) return ' docker container '
  if (location === EExecutionLocation.Cloud) return ' cloud sandbox '

  return ' host '
}

const STUB = 4

export function LocationDivider(props: {
  width: number
  location: EExecutionLocation
}): React.ReactNode {
  const label = labelOf(props.location)
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
