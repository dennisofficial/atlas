import React, { useRef } from 'react'
import type { BoxRenderable } from '@opentui/core'

import type { ContextTreeLevels, ContextTreeRow } from '../../context-tree-model'
import { useClickRegion } from '../../hooks/use-click-region'
import { useContextTreeReveal } from '../../hooks/use-context-tree-reveal'
import { glyph, theme } from '../../theme'
import { Row } from './row'

function ContextRow(props: {
  row: ContextTreeRow
  level: ContextTreeLevels
  cells: number
  cursor: boolean
  focused: boolean
  opened: boolean
  onActivate: (path: string) => void
}): React.ReactNode {
  const { row } = props
  const region = useClickRegion(() => props.onActivate(row.path))
  const depth = Math.min(row.depth, Math.max(0, Math.floor((props.cells - 10) / 2)))
  const prefix = `${'  '.repeat(depth)}${row.depth > depth ? '…' : ''}${row.isDirectory ? (row.expanded ? '▾' : '▸') : ' '} `
  const level = props.level.get(row.path)
  const status = !row.isDirectory || !row.expanded ? undefined :
    level?.error ? 'unavailable' : level === undefined ? 'reading…' : level.entries.length === 0 ? 'empty' : undefined
  const selected = props.opened || (props.cursor && props.focused)
  return (
    <box flexShrink={0} {...region.handlers} backgroundColor={region.wash.bg ?? (selected ? theme.userBg : theme.panelBg)}>
      <Row label={row.name} labelFg={props.cursor && props.focused ? theme.court.external : theme.hover} cells={props.cells}
        mark={{ text: `${prefix}${row.isDirectory ? glyph.file : glyph.document}`, fg: props.cursor && props.focused ? theme.court.external : theme.hint }}
        {...(status === undefined ? {} : { value: [{ text: status, fg: level?.error ? theme.warn : theme.hint }] })} />
    </box>
  )
}

export type ContextSectionProps = {
  rows: readonly ContextTreeRow[]
  levels: ContextTreeLevels
  cursor: string | null
  opened: string | null
  focused: boolean
  loading: boolean
  cells: number
  onFocus: () => void
  onActivate: (path: string) => void
}

export function ContextSection(props: ContextSectionProps): React.ReactNode {
  const root = useRef<BoxRenderable | null>(null)
  const header = useClickRegion(props.onFocus)
  useContextTreeReveal({ root, rows: props.rows, cursor: props.cursor, focused: props.focused })
  const unreadable = props.levels.get('')?.error != null
  return (
    <box ref={root} flexDirection="column" flexShrink={0}>
      <box {...header.handlers} backgroundColor={header.wash.bg ?? theme.panelBg}>
        <text fg={theme.meta}>CONTEXT  <span fg={theme.hint}>{props.rows.length}</span></text>
      </box>
      {props.rows.length === 0 ? <text fg={theme.hint} width={props.cells}>
        {props.loading ? 'Reading context…' : unreadable ? 'Context unavailable' : 'No context files yet'}
      </text> : null}
      {props.rows.map((row) => (
        <ContextRow key={row.path} row={row} level={props.levels} cells={props.cells}
          cursor={props.cursor === row.path} focused={props.focused} opened={props.opened === row.path} onActivate={props.onActivate} />
      ))}
      {props.focused ? <text fg={theme.hint} width={props.cells} wrapMode="none">↑↓ move · ←→ folders · enter open</text> : null}
    </box>
  )
}
