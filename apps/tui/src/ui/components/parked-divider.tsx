import React from 'react'

import { theme, TRANSCRIPT_INSET } from '../theme'

const inFlightLabel = (args: {
  shellsRunning: number
  childrenRunning: number
}): string => {
  const counts: string[] = []
  if (args.shellsRunning > 0) {
    counts.push(`${args.shellsRunning} shell${args.shellsRunning === 1 ? '' : 's'}`)
  }
  if (args.childrenRunning > 0) {
    counts.push(`${args.childrenRunning} agent${args.childrenRunning === 1 ? '' : 's'}`)
  }
  if (counts.length === 0) return ''

  return ` · ${counts.join(', ')} in flight`
}

const labelOf = (args: {
  reason: string
  shellsRunning: number
  childrenRunning: number
}): string =>
  ` ☾ parked after ${args.reason}${inFlightLabel({ shellsRunning: args.shellsRunning, childrenRunning: args.childrenRunning })} `

const STUB = 4

export function ParkedDivider(props: {
  width: number
  reason: string
  shellsRunning: number
  childrenRunning: number
}): React.ReactNode {
  const label = labelOf(props)
  const total = Math.max(label.length + STUB * 2, props.width - TRANSCRIPT_INSET)
  const left = Math.max(STUB, Math.floor((total - label.length) / 2))
  const right = Math.max(STUB, total - label.length - left)

  return (
    <box flexDirection="row" marginTop={1} marginBottom={1}>
      <text fg={theme.rule}>
        {'─'.repeat(left)}
        <span fg={theme.hint}>{label}</span>
        {'─'.repeat(right)}
      </text>
    </box>
  )
}
