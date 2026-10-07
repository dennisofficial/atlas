import React, { useMemo } from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import { wrapWords } from '../../text-flow'
import { glyph, theme, TRANSCRIPT_INSET } from '../../theme'

const NARROWEST_BAND = 24

const BODY_INDENT = 2

const OPEN_HINT = '↵ details'

export function QualityNoticeBlock(props: {
  text: string
  body: string
  failure: boolean
  width: number
  expanded?: boolean | undefined
  onToggle?: (() => void) | undefined
}): React.ReactNode {
  const inner = Math.max(NARROWEST_BAND, props.width - TRANSCRIPT_INSET)
  const { handlers, hovered, wash } = useClickRegion(props.body === '' ? undefined : props.onToggle)
  const opened = props.expanded === true && props.body !== ''
  const mark = props.failure
    ? { text: `${glyph.failed} `, fg: theme.error }
    : { text: `${glyph.warning} `, fg: theme.warn }
  const rows = useMemo(
    () =>
      props.body
        .split('\n')
        .flatMap((line) => (line === '' ? [''] : wrapWords({ text: line, width: inner - BODY_INDENT }))),
    [props.body, inner],
  )

  return (
    <box flexDirection="column" marginBottom={1} flexShrink={0} {...handlers}>
      <text wrapMode="none" width={inner} flexShrink={0}>
        <span fg={mark.fg} {...wash}>{mark.text}</span>
        <span fg={hovered ? theme.hover : props.failure ? theme.error : theme.warn} {...wash}>{props.text}</span>
        {props.body === '' || opened ? null : <span fg={theme.dim} {...wash}>{`  ${OPEN_HINT}`}</span>}
      </text>
      {opened
        ? rows.map((row, index) => (
            <text key={index} wrapMode="none" width={inner} flexShrink={0}>
              <span fg={theme.hint}>{`${' '.repeat(BODY_INDENT)}${row}`}</span>
            </text>
          ))
        : null}
    </box>
  )
}
