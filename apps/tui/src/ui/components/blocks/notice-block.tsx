import { TextAttributes } from '@opentui/core'
import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import { wrapWords } from '../../text-flow'
import { glyph, theme, TRANSCRIPT_INSET } from '../../theme'

const NARROWEST_BAND = 24

const BODY_INDENT = 2

const QUEUED = '  queued'

const PREVIEW_CAP = 4

export function NoticeBlock(props: {
  text: string
  body: string | null
  failed: boolean
  width: number
  openHint: string
  silentNote?: string
  expanded?: boolean
  onToggle?: () => void
  pending?: boolean
}): React.ReactNode {
  const inner = Math.max(NARROWEST_BAND, props.width - TRANSCRIPT_INSET)
  const body = props.body?.trimEnd() ?? ''
  const { handlers, hovered } = useClickRegion(
    props.pending === true || body === '' ? undefined : props.onToggle,
  )
  const opened = props.pending !== true && props.expanded === true
  const preview = props.pending === true ? previewLines(props.body, props.silentNote) : []

  return (
    <box flexDirection="column" marginBottom={1} flexShrink={0} {...handlers}>
      <HeadingRow
        text={props.text}
        failed={props.failed}
        inner={inner}
        hovered={hovered}
        hint={props.openHint}
        affordance={body !== '' && props.expanded !== true && props.pending !== true}
        dimmed={props.pending === true}
      />
      {props.pending === true ? (
        <>
          {preview.map((line, index) => (
            <BodyRow key={index} text={line} inner={inner} dimmed />
          ))}
        </>
      ) : body === '' ? (
        props.silentNote === undefined ? null : <BodyRow text={props.silentNote} inner={inner} />
      ) : opened ? (
        <Body text={body} inner={inner} />
      ) : null}
    </box>
  )
}

function previewLines(
  body: string | null,
  silentNote: string | undefined,
): readonly string[] {
  if (body === null) return []
  const trimmed = body.trimEnd()
  if (trimmed === '') return silentNote === undefined ? [] : [silentNote]
  const lines = trimmed.split('\n')
  if (lines.length <= PREVIEW_CAP) return lines
  return [...lines.slice(0, PREVIEW_CAP), '…']
}

function HeadingRow(props: {
  text: string
  failed: boolean
  inner: number
  hovered: boolean
  hint: string
  affordance: boolean
  dimmed: boolean
}): React.ReactNode {
  const mark = props.failed ? theme.error : theme.ok

  return (
    <text
      wrapMode="none"
      width={props.inner}
      flexShrink={0}
      attributes={props.dimmed ? TextAttributes.DIM : TextAttributes.NONE}
    >
      <span fg={mark}>{`${glyph.block} `}</span>
      <span fg={props.hovered ? theme.hover : theme.meta}>{props.text}</span>
      {props.affordance ? <span fg={theme.dim}>{`  ${props.hint}`}</span> : null}
      {props.dimmed ? <span fg={theme.dim}>{QUEUED}</span> : null}
    </text>
  )
}

function Body(props: { text: string; inner: number }): React.ReactNode {
  const band = Math.max(1, props.inner - BODY_INDENT)
  const rows = props.text.split('\n').flatMap((line) => wrapWords({ text: line, width: band }))

  return (
    <>
      {rows.map((row, index) => (
        <BodyRow key={index} text={row} inner={props.inner} />
      ))}
    </>
  )
}

function BodyRow(props: { text: string; inner: number; dimmed?: boolean }): React.ReactNode {
  return (
    <text
      wrapMode="none"
      width={props.inner}
      flexShrink={0}
      {...(props.dimmed === true ? { attributes: TextAttributes.DIM } : {})}
    >
      <span fg={theme.hint}>
        {' '.repeat(BODY_INDENT)}
        {props.text}
      </span>
    </text>
  )
}
