import React from 'react'

import { plural } from '@dltech/atlas-client/transcript'
import type { SidebarCrewFold } from '../../../store/subagent-row'
import { useClickRegion } from '../../hooks/use-click-region'
import {
  EServiceTone,
  isRowRunning,
  rowStateLabel,
  rowTone,
  rowUrl,
  type ServiceRow,
} from '../../services-model'
import { glyph, theme } from '../../theme'
import type { Span } from '../spans'
import { Row, Section } from './row'

const TONE_MARK: Record<EServiceTone, string> = {
  [EServiceTone.Ok]: theme.ok,
  [EServiceTone.Idle]: theme.rule,
  [EServiceTone.Attention]: theme.warn,
}

const valueFor = (args: { row: ServiceRow; now: number }): readonly Span[] => {
  const url = rowUrl(args.row)
  return [
    ...(url === undefined ? [] : [{ text: `${url}  `, fg: theme.hint }]),
    {
      text: rowStateLabel(args),
      fg: rowTone(args.row) === EServiceTone.Attention ? theme.warn : theme.meta,
    },
  ]
}

function FoldedLine(props: { fold: SidebarCrewFold; cells: number }): React.ReactNode {
  return (
    <Row
      label={plural(props.fold.hidden, 'more')}
      labelFg={theme.rule}
      cells={props.cells}
      mark={{ text: glyph.active, fg: theme.rule }}
      {...(props.fold.hiddenFailed ? { value: [{ text: 'one failed', fg: theme.warn }] } : {})}
    />
  )
}

function ServiceLine(props: {
  row: ServiceRow
  now: number
  cells: number
  onOpen?: ((key: string) => void) | undefined
}): React.ReactNode {
  const { row } = props
  const click = useClickRegion(
    props.onOpen === undefined ? undefined : () => props.onOpen?.(row.key),
  )

  return (
    <box
      flexShrink={0}
      {...(click.wash.bg === undefined ? {} : { backgroundColor: click.wash.bg })}
      {...click.handlers}
    >
      <Row
        label={row.name}
        labelFg={isRowRunning(row) ? theme.hover : theme.meta}
        cells={props.cells}
        mark={{ text: glyph.active, fg: TONE_MARK[rowTone(row)] }}
        value={valueFor({ row, now: props.now })}
      />
    </box>
  )
}

export function ServicesSection(props: {
  rows: readonly ServiceRow[]
  now: number
  cells: number
  fold?: SidebarCrewFold | undefined
  onOpen?: (key: string) => void
}): React.ReactNode {
  const hidden = props.fold?.hidden ?? 0
  if (props.rows.length === 0 && hidden === 0) return null

  const running = props.rows.filter(isRowRunning).length

  return (
    <Section label="Services" count={`${running}/${props.rows.length + hidden}`}>
      {props.rows.map((row) => (
        <ServiceLine
          key={row.key}
          row={row}
          now={props.now}
          cells={props.cells}
          onOpen={props.onOpen}
        />
      ))}
      {props.fold === undefined || props.fold.hidden === 0 ? null : (
        <FoldedLine fold={props.fold} cells={props.cells} />
      )}
    </Section>
  )
}
