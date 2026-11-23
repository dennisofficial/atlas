import React from 'react'

import { wrapWords } from '../text-flow'
import { theme, TRANSCRIPT_INSET } from '../theme'

const STUB = 4

export function RotatedDivider(props: {
  width: number
  text: string
  handoff: string
}): React.ReactNode {
  const label = ` ${props.text} `
  const total = Math.max(label.length + STUB * 2, props.width - TRANSCRIPT_INSET)
  const left = Math.max(STUB, Math.floor((total - label.length) / 2))
  const right = Math.max(STUB, total - label.length - left)
  const detail = wrapWords({
    text: props.handoff,
    width: Math.max(label.length, total),
  })

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <text fg={theme.meta}>
        {'─'.repeat(left)}
        {label}
        {'─'.repeat(right)}
      </text>
      {detail.map((line) => (
        <text key={line} fg={theme.hint}>
          {line}
        </text>
      ))}
    </box>
  )
}
