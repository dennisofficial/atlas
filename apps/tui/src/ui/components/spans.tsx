import { TextAttributes } from '@opentui/core'
import React from 'react'

export type Span = { text: string; fg?: string; bg?: string; strike?: boolean }

export function Spans(props: { spans: readonly Span[] }): React.ReactNode {
  return (
    <>
      {props.spans.map((span, index) => (
        <span
          key={index}
          {...(span.fg === undefined ? {} : { fg: span.fg })}
          {...(span.bg === undefined ? {} : { bg: span.bg })}
          {...(span.strike === true ? { attributes: TextAttributes.STRIKETHROUGH } : {})}
        >
          {span.text}
        </span>
      ))}
    </>
  )
}
