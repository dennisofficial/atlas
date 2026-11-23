import React from 'react'

import { wrapWords } from '../text-flow'
import { theme, TRANSCRIPT_INSET } from '../theme'

const LABEL = ' context rotated '

const STUB = 4

export function RotatedDivider(props: { width: number; handoff: string }): React.ReactNode {
  const total = Math.max(LABEL.length + STUB * 2, props.width - TRANSCRIPT_INSET)
  const left = Math.max(STUB, Math.floor((total - LABEL.length) / 2))
  const right = Math.max(STUB, total - LABEL.length - left)
  const detail = wrapWords({
    text: props.handoff,
    width: Math.max(LABEL.length, total),
  })

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <text fg={theme.meta}>
        {'─'.repeat(left)}
        {LABEL}
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
