import React from 'react'

import type { ContextTreeLevels, ContextTreeRow } from '../../context-tree-model'
import { useClickRegion } from '../../hooks/use-click-region'
import { glyph, theme } from '../../theme'
import { Row } from './row'

function ContextRow(props: {
  row: ContextTreeRow
  level: ContextTreeLevels
  cells: number
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
  return (
    <box flexShrink={0} {...region.handlers} backgroundColor={region.wash.bg ?? (props.opened ? theme.userBg : theme.panelBg)}>
      <Row label={row.name} labelFg={theme.hover} cells={props.cells}
        mark={{ text: `${prefix}${row.isDirectory ? glyph.file : glyph.document}`, fg: theme.hint }}
        {...(status === undefined ? {} : { value: [{ text: status, fg: level?.error ? theme.warn : theme.hint }] })} />
    </box>
  )
}

export type ContextSectionProps = {
  rows: readonly ContextTreeRow[]
  levels: ContextTreeLevels
  opened: string | null
  loading: boolean
  cells: number
  onActivate: (path: string) => void
}

export function ContextSection(props: ContextSectionProps): React.ReactNode {
  const unreadable = props.levels.get('')?.error != null
  return (
    <box flexDirection="column" flexShrink={0}>
      <box backgroundColor={theme.panelBg}>
        <text fg={theme.meta}>CONTEXT  <span fg={theme.hint}>{props.rows.length}</span></text>
      </box>
      {props.rows.length === 0 ? <text fg={theme.hint} width={props.cells}>
        {props.loading ? 'Reading context…' : unreadable ? 'Context unavailable' : 'No context files yet'}
      </text> : null}
      {props.rows.map((row) => (
        <ContextRow key={row.path} row={row} level={props.levels} cells={props.cells}
          opened={props.opened === row.path} onActivate={props.onActivate} />
      ))}
    </box>
  )
}
