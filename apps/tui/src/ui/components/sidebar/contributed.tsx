import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import {
  isSidebarRowSplit,
  sectionsAt,
  spansOf,
  type ESidebarPlace,
  type SidebarRowAction,
  type SidebarSection,
  type SidebarSectionRow,
} from '../../sidebar-section'
import { theme } from '../../theme'
import { Spans } from '../spans'
import { Row, Section } from './row'

const ACTION_CELLS = 2

function RowAction(props: { action: SidebarRowAction }): React.ReactNode {
  const region = useClickRegion(props.action.onActivate)

  return (
    <box
      flexShrink={0}
      width={ACTION_CELLS}
      {...region.handlers}
      {...(region.wash.bg === undefined ? {} : { backgroundColor: region.wash.bg })}
    >
      <text>
        <Spans spans={[{ text: ` ${props.action.glyph}`, fg: props.action.fg ?? theme.meta }]} />
      </text>
    </box>
  )
}

function ContributedRow(props: { row: SidebarSectionRow; cells: number }): React.ReactNode {
  const region = useClickRegion(props.row.onActivate)
  const content = spansOf({ row: props.row, cells: props.cells })
  const left = isSidebarRowSplit(content) ? content.left : undefined
  const value = isSidebarRowSplit(content) ? content.right : content

  const { action } = props.row
  const cells = action === undefined ? props.cells : Math.max(0, props.cells - ACTION_CELLS)

  const body = (
    <box
      flexShrink={0}
      {...(action === undefined ? {} : { width: cells })}
      {...region.handlers}
      {...(region.wash.bg === undefined ? {} : { backgroundColor: region.wash.bg })}
    >
      <Row
        label=""
        labelFg={theme.meta}
        cells={cells}
        value={value}
        {...(left === undefined ? {} : { left })}
      />
    </box>
  )

  if (action === undefined) return body

  return (
    <box flexShrink={0} flexDirection="row">
      {body}
      <RowAction action={action} />
    </box>
  )
}

function ContributedSection(props: { section: SidebarSection; cells: number }): React.ReactNode {
  const rows = props.section.rows.map((row) => (
    <ContributedRow key={row.id} row={row} cells={props.cells} />
  ))

  if (props.section.label === undefined) {
    return (
      <box flexDirection="column" flexShrink={0}>
        {rows}
      </box>
    )
  }

  return <Section label={props.section.label}>{rows}</Section>
}

export function ContributedSections(props: {
  sections: readonly SidebarSection[]
  place: ESidebarPlace
  cells: number
}): React.ReactNode {
  const showing = sectionsAt({ sections: props.sections, place: props.place })
  if (showing.length === 0) return null

  return (
    <>
      {showing.map((section) => (
        <ContributedSection key={section.id} section={section} cells={props.cells} />
      ))}
    </>
  )
}
