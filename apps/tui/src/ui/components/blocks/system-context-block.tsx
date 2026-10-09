import React from 'react'

import type { SystemContextEntry, SystemContextItem } from '../../../store/transcript-model'
import { useClickRegion } from '../../hooks/use-click-region'
import { glyph, theme, TRANSCRIPT_INSET } from '../../theme'
import { injectionKey } from './system-context-expansion'

const NARROWEST_BAND = 24

const LISTED = 2

const CONTENT_INDENT = 4

const NOTHING_OPEN: ReadonlySet<string> = new Set()

const ignore = (): void => undefined

const SUPERSEDED = ' · superseded'

function ClickRow(props: {
  indent: number
  text: string
  note: string
  inner: number
  onPress: () => void
}): React.ReactNode {
  const region = useClickRegion(props.onPress)

  return (
    <text wrapMode="none" width={props.inner} flexShrink={0} {...region.handlers}>
      <span fg={theme.dim} {...region.wash}>
        {`${' '.repeat(props.indent)}${glyph.available} `}
      </span>
      <span fg={region.hovered ? theme.hover : theme.hint} {...region.wash}>
        {props.text}
      </span>
      <span fg={theme.dim} {...region.wash}>
        {props.note}
      </span>
    </text>
  )
}

function ItemRows(props: {
  item: SystemContextItem
  title: string
  indent: number
  inner: number
  open: boolean
  onToggle: (key: string) => void
}): React.ReactNode {
  const { item, indent } = props

  return (
    <>
      <ClickRow
        indent={indent}
        text={props.title}
        note={item.superseded ? SUPERSEDED : ''}
        inner={props.inner}
        onPress={() => props.onToggle(injectionKey(item.key))}
      />
      {props.open ? (
        <text
          wrapMode="word"
          width={props.inner}
          paddingLeft={indent + CONTENT_INDENT - LISTED}
          flexShrink={0}
          fg={theme.hint}
        >
          {item.content.trimEnd()}
        </text>
      ) : null}
    </>
  )
}

export function SystemContextBlock(props: {
  entry: SystemContextEntry
  width: number
  expanded: boolean
  opened?: ReadonlySet<string>
  onToggle?: (key: string) => void
}): React.ReactNode {
  const { entry } = props
  const opened = props.opened ?? NOTHING_OPEN
  const onToggle = props.onToggle ?? ignore
  const inner = Math.max(NARROWEST_BAND, props.width - TRANSCRIPT_INSET)
  const [only] = entry.items

  if (entry.items.length === 1 && only !== undefined) {
    return (
      <box flexDirection="column" marginBottom={1} width={inner} flexShrink={0}>
        <ItemRows
          item={only}
          title={`Atlas loaded ${only.label}`}
          indent={0}
          inner={inner}
          open={opened.has(injectionKey(only.key))}
          onToggle={onToggle}
        />
      </box>
    )
  }

  return (
    <box flexDirection="column" marginBottom={1} width={inner} flexShrink={0}>
      <ClickRow
        indent={0}
        text={`Atlas loaded ${entry.text}`}
        note=""
        inner={inner}
        onPress={() => onToggle(entry.key)}
      />
      {props.expanded
        ? entry.items.map((item) => (
            <ItemRows
              key={item.key}
              item={item}
              title={item.label}
              indent={LISTED}
              inner={inner}
              open={opened.has(injectionKey(item.key))}
              onToggle={onToggle}
            />
          ))
        : null}
    </box>
  )
}
