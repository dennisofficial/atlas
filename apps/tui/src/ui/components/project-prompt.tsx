import React from 'react'

import type { Hint } from '../hint-layout'
import { useClickRegion } from '../hooks/use-click-region'
import {
  EProjectField,
  EProjectPrompt,
  NO_WORKSPACE_LABEL,
  PROJECT_LIST_ROWS,
  rowWindow,
  type CreateState,
  type PickState,
  type ProjectPromptState,
  type ProjectRow,
} from '../project-prompt-model'
import { glyph, theme } from '../theme'
import { BottomDrawer, drawerCells, DrawerGap, DrawerHeading, DrawerHints, DrawerLine } from './drawer'
import { clipSpans, spanCells } from './sidebar/cells'
import { Spans, type Span } from './spans'

export const PICK_HEADING = 'Run this thread in a project'

export const CREATE_HEADING = 'Create a project for this repository'

export const NO_PROJECTS_HINT = 'No projects yet — launching Atlas from a GitHub repository creates one automatically.'

const CARET = '▏'

const BASE_PLACEHOLDER = "empty uses the repository's default branch"

const PICK_HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'pick' },
  { key: '⏎', label: 'choose' },
  { key: 'esc', label: 'cancel' },
]

const CREATE_HINTS: readonly Hint[] = [
  { key: '⏎', label: 'create' },
  { key: 'tab', label: 'next field' },
  { key: 'esc', label: 'cancel' },
]

function Line(props: { spans: readonly Span[]; cells: number }): React.ReactNode {
  return (
    <DrawerLine>
      <text>
        <Spans spans={clipSpans({ spans: props.spans, cells: props.cells })} />
      </text>
    </DrawerLine>
  )
}

function PickRow(props: { row: ProjectRow; cells: number; selected: boolean; onChoose: () => void }): React.ReactNode {
  const click = useClickRegion(props.onChoose)
  const band = props.selected ? theme.hoverBg : click.wash.bg
  const none = props.row.projectId === null

  const mark: Span = { text: `${props.selected ? glyph.marker : ' '} `, fg: theme.accent }
  const name: Span = { text: props.row.name, fg: props.selected ? theme.bright : none ? theme.hint : theme.hover }
  const repo: Span = { text: props.row.repo === null ? '' : props.row.repo, fg: theme.hint }
  const gap = Math.max(1, props.cells - spanCells([mark, name, repo]))

  return (
    <DrawerLine {...(band === undefined ? {} : { band })} press={click.handlers}>
      <text>
        <Spans spans={clipSpans({ spans: [mark, name, { text: ' '.repeat(gap) }, repo], cells: props.cells })} />
      </text>
    </DrawerLine>
  )
}

function Pick(props: {
  state: PickState
  cells: number
  onChoose: (index: number) => void
}): React.ReactNode {
  const { rows, index } = props.state
  const window = rowWindow({ count: rows.length, index, size: PROJECT_LIST_ROWS })
  const onlyNone = rows.length === 1 && rows[0]?.name === NO_WORKSPACE_LABEL

  return (
    <>
      <DrawerHeading label={PICK_HEADING} />
      <DrawerGap />
      {rows.slice(window.start, window.end).map((row, offset) => (
        <PickRow
          key={row.projectId ?? NO_WORKSPACE_LABEL}
          row={row}
          cells={props.cells}
          selected={window.start + offset === index}
          onChoose={() => props.onChoose(window.start + offset)}
        />
      ))}
      {onlyNone ? (
        <>
          <DrawerGap />
          <Line spans={[{ text: NO_PROJECTS_HINT, fg: theme.hint }]} cells={props.cells} />
        </>
      ) : null}
    </>
  )
}

function Field(props: {
  label: string
  value: string
  placeholder?: string
  active: boolean
  cells: number
  onFocus: () => void
}): React.ReactNode {
  const click = useClickRegion(props.onFocus)
  const band = click.wash.bg
  const body: Span[] =
    props.value.length === 0 && props.placeholder !== undefined
      ? [{ text: props.placeholder, fg: theme.hint }]
      : [{ text: props.value, fg: theme.bright }]

  return (
    <box flexDirection="column" flexShrink={0}>
      <DrawerLine>
        <text fg={props.active ? theme.accent : theme.meta}>{props.label.toUpperCase()}</text>
      </DrawerLine>
      <DrawerLine {...(band === undefined ? {} : { band })} press={click.handlers}>
        <text>
          <Spans
            spans={clipSpans({
              spans: [
                { text: `${props.active ? glyph.marker : ' '} `, fg: theme.accent },
                ...body,
                ...(props.active ? [{ text: CARET, fg: theme.accent }] : []),
              ],
              cells: props.cells,
            })}
          />
        </text>
      </DrawerLine>
    </box>
  )
}

function Create(props: {
  state: CreateState
  cells: number
  onFocus: (field: EProjectField) => void
}): React.ReactNode {
  const { state } = props
  return (
    <>
      <DrawerHeading label={CREATE_HEADING} />
      <DrawerGap />
      <box flexDirection="column" flexShrink={0}>
        <DrawerLine>
          <text fg={theme.meta}>REPOSITORY</text>
        </DrawerLine>
        <Line spans={[{ text: `  ${state.repo}`, fg: theme.hint }]} cells={props.cells} />
      </box>
      <Field
        label="Name"
        value={state.name}
        active={state.field === EProjectField.Name}
        cells={props.cells}
        onFocus={() => props.onFocus(EProjectField.Name)}
      />
      <Field
        label="Base branch"
        value={state.base}
        placeholder={BASE_PLACEHOLDER}
        active={state.field === EProjectField.Base}
        cells={props.cells}
        onFocus={() => props.onFocus(EProjectField.Base)}
      />
      {state.problem === null ? null : (
        <>
          <DrawerGap />
          <Line spans={[{ text: state.problem, fg: theme.warn }]} cells={props.cells} />
        </>
      )}
    </>
  )
}

export function ProjectPrompt(props: {
  width: number
  state: ProjectPromptState
  overlay?: boolean
  onChoose: (index: number) => void
  onFocusField: (field: EProjectField) => void
  onCancel: () => void
}): React.ReactNode {
  const cells = drawerCells({ width: props.width })
  const pick = props.state.mode === EProjectPrompt.Pick

  return (
    <BottomDrawer
      overlay={props.overlay === true}
      footer={<DrawerHints hints={pick ? PICK_HINTS : CREATE_HINTS} cells={cells} onDismiss={props.onCancel} />}
    >
      <box flexDirection="column" flexShrink={0}>
        {props.state.mode === EProjectPrompt.Pick ? (
          <Pick state={props.state} cells={cells} onChoose={props.onChoose} />
        ) : (
          <Create state={props.state} cells={cells} onFocus={props.onFocusField} />
        )}
        <DrawerGap />
      </box>
    </BottomDrawer>
  )
}
