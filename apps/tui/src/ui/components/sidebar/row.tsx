import React from 'react'

import { theme } from '../../theme'
import { Spans, type Span } from '../spans'
import { clipSpans, fitLabel, justifySpans, spanCells } from './cells'

const COUNT_SEPARATOR = '  '

export function Row(props: {
  label: string
  labelFg: string
  cells: number
  mark?: Span
  value?: readonly Span[]
  left?: readonly Span[]
}): React.ReactNode {
  const markSpans = props.mark === undefined ? [] : [props.mark, { text: ' ' }]
  const cells = Math.max(0, props.cells - spanCells(markSpans))

  if (props.left !== undefined) {
    const justified = justifySpans({ left: props.left, right: props.value ?? [], cells })
    return (
      <text>
        <Spans spans={[...markSpans, ...justified]} />
      </text>
    )
  }

  const value = clipSpans({ spans: props.value ?? [], cells })
  const label = fitLabel({ label: props.label, valueCells: spanCells(value), cells })

  return (
    <text>
      <Spans spans={[...markSpans, { text: label, fg: props.labelFg }, ...value]} />
    </text>
  )
}

export function Section(props: {
  label: string
  count?: string
  cells?: number
  children: React.ReactNode
}): React.ReactNode {
  const label: Span = { text: props.label.toUpperCase(), fg: theme.meta }
  const count: readonly Span[] =
    props.count === undefined ? [] : [{ text: props.count, fg: theme.hint }]
  const header =
    props.cells === undefined
      ? [label, ...count.map((span) => ({ ...span, text: `${COUNT_SEPARATOR}${span.text}` }))]
      : justifySpans({ left: [label], right: count, cells: props.cells })

  return (
    <box flexDirection="column" flexShrink={0}>
      <text>
        <Spans spans={header} />
      </text>
      {props.children}
    </box>
  )
}
