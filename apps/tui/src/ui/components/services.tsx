import React from 'react'

import { type Hint } from '../hint-layout'
import type { OutputScroll } from '../hooks/use-output-scroll'
import { useClickRegion } from '../hooks/use-click-region'
import { usePress, type PressHandlers } from '../hooks/use-press'
import {
  isRowRunning,
  isServiceRunning,
  rowActions,
  rowServiceId,
  rowStateLabel,
  rowTone,
  rowUrl,
  EServiceTone,
  type ServiceRow,
} from '../services-model'
import { outputRows } from '../shells-model'
import { glyph, theme } from '../theme'
import {
  drawerCells,
  DrawerHints,
  DrawerLine,
  DRAWER_INSET,
  EDrawerEdge,
  SideDrawer,
} from './drawer'
import { clipSpans } from './sidebar/cells'
import { Spans, type Span } from './spans'

export const SERVICES_INSET = DRAWER_INSET

export const servicesCells = (args: { width: number }): number => drawerCells(args)

const SCROLLBACK_ROWS = 1_000

const SCROLLBAR_COLUMN = 1

const NOTHING_PRINTED = 'It has printed nothing yet.'

const BACK_TO_END = 'back to the end'

function GroupHeader(props: { label: string; count?: string; note?: string }): React.ReactNode {
  return (
    <DrawerLine>
      <text>
        <Spans
          spans={[
            { text: props.label.toUpperCase(), fg: theme.meta },
            ...(props.count === undefined ? [] : [{ text: `  ${props.count}`, fg: theme.hint }]),
            ...(props.note === undefined ? [] : [{ text: `  ${props.note}`, fg: theme.warn }]),
          ]}
        />
      </text>
    </DrawerLine>
  )
}

const TONE_MARK: Record<EServiceTone, string> = {
  [EServiceTone.Ok]: theme.ok,
  [EServiceTone.Idle]: theme.rule,
  [EServiceTone.Attention]: theme.warn,
}

function ServiceHeading(props: { row: ServiceRow; now: number; cells: number }): React.ReactNode {
  const { row } = props
  const url = rowUrl(row)
  const command = row.snapshot?.command.replace(/\s+/g, ' ').trim()

  const spans: Span[] = [
    { text: glyph.active, fg: TONE_MARK[rowTone(row)] },
    { text: ' ' },
    { text: row.name, fg: theme.bright },
    { text: '  ' },
    { text: rowStateLabel({ row, now: props.now }), fg: theme.meta },
    ...(url === undefined ? [] : [{ text: '  ' }, { text: url, fg: theme.hover }]),
    ...(command === undefined ? [] : [{ text: '  ' }, { text: command, fg: theme.dim }]),
  ]

  return (
    <DrawerLine band={theme.panelBg}>
      <text>
        <Spans spans={clipSpans({ spans, cells: props.cells })} />
      </text>
    </DrawerLine>
  )
}

function ActionLine(props: {
  glyphText: string
  label: string
  fg: string
  onPress: () => void
}): React.ReactNode {
  const click = useClickRegion(props.onPress)

  return (
    <DrawerLine
      {...(click.wash.bg === undefined ? {} : { band: click.wash.bg })}
      press={click.handlers}
    >
      <text>
        <Spans
          spans={[
            { text: `${props.glyphText} `, fg: props.fg },
            { text: props.label, fg: theme.hover },
          ]}
        />
      </text>
    </DrawerLine>
  )
}

function RowActions(props: {
  row: ServiceRow
  onStart: (name: string) => void
  onRestart: (serviceId: string) => void
  onStop: (serviceId: string) => void
}): React.ReactNode {
  const { row } = props
  const actions = rowActions(row)
  const serviceId = rowServiceId(row)

  return (
    <>
      {actions.start ? (
        <ActionLine
          glyphText={glyph.passed}
          label="start it"
          fg={theme.ok}
          onPress={() => props.onStart(row.name)}
        />
      ) : null}
      {actions.restart && serviceId !== undefined ? (
        <ActionLine
          glyphText={glyph.retry}
          label="restart it"
          fg={theme.warn}
          onPress={() => props.onRestart(serviceId)}
        />
      ) : null}
      {actions.stop && serviceId !== undefined ? (
        <ActionLine
          glyphText={glyph.failed}
          label="stop it"
          fg={theme.warn}
          onPress={() => props.onStop(serviceId)}
        />
      ) : null}
    </>
  )
}

function OutputSection(props: {
  log: string
  cells: number
  jumpPress: PressHandlers
  scroll?: OutputScroll | undefined
}): React.ReactNode {
  const wrapCells = Math.max(0, props.cells - SCROLLBAR_COLUMN)
  const rows = outputRows({ text: props.log, cells: wrapCells, limit: SCROLLBACK_ROWS })
  const scroll = props.scroll
  const scrolledBack = scroll !== undefined && !scroll.pinned

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0}>
      <GroupHeader label="Log" {...(scrolledBack ? { note: 'scrolled back' } : {})} />
      {rows.length === 0 ? (
        <DrawerLine>
          <text fg={theme.meta}>{NOTHING_PRINTED}</text>
        </DrawerLine>
      ) : (
        <scrollbox
          {...(scroll === undefined ? {} : { ref: scroll.attach })}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          focusable={false}
          stickyScroll
          stickyStart="bottom"
          viewportCulling
        >
          {rows.map((row, index) => (
            <DrawerLine key={index}>
              <text fg={theme.hover}>{row}</text>
            </DrawerLine>
          ))}
        </scrollbox>
      )}
      {scrolledBack ? (
        <DrawerLine press={props.jumpPress}>
          <text fg={theme.warn}>{`↓ ${BACK_TO_END}`}</text>
        </DrawerLine>
      ) : null}
    </box>
  )
}

const WALKING: readonly Hint[] = [
  { key: '↑↓', label: 'pick' },
  { key: 's', label: 'start' },
  { key: 'r', label: 'restart' },
  { key: 'k', label: 'stop' },
  { key: 'esc', label: 'close' },
]

export function Services(props: {
  width: number
  rows: readonly ServiceRow[]
  now: number
  selected: ServiceRow | undefined
  log: string
  notice?: string | null
  scroll?: OutputScroll | undefined
  overlay?: boolean
  onStart: (name: string) => void
  onRestart: (serviceId: string) => void
  onStop: (serviceId: string) => void
  onDismiss: () => void
}): React.ReactNode {
  const cells = servicesCells({ width: props.width })
  const press = usePress()
  const running = props.rows.filter(isRowRunning).length
  const selected = props.selected
  const reason = selected?.declared?.reason

  return (
    <SideDrawer
      width={props.width}
      side={EDrawerEdge.Left}
      overlay={props.overlay === true}
      footer={<DrawerHints hints={WALKING} cells={cells} onDismiss={props.onDismiss} />}
    >
      {selected === undefined ? (
        <box flexDirection="column" flexShrink={0}>
          <GroupHeader label="Services" count={`${running}/${props.rows.length}`} />
          <DrawerLine>
            <text fg={theme.meta}>Nothing is declared or running.</text>
          </DrawerLine>
        </box>
      ) : (
        <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0}>
          <GroupHeader label="Service log" count={`${running}/${props.rows.length}`} />
          <ServiceHeading row={selected} now={props.now} cells={cells} />
          {props.notice === null || props.notice === undefined ? null : (
            <DrawerLine>
              <text fg={theme.warn}>
                <Spans spans={clipSpans({ spans: [{ text: props.notice }], cells })} />
              </text>
            </DrawerLine>
          )}
          {reason === undefined ? null : (
            <DrawerLine>
              <text fg={theme.meta}>
                <Spans spans={clipSpans({ spans: [{ text: reason }], cells })} />
              </text>
            </DrawerLine>
          )}
          <RowActions
            row={selected}
            onStart={props.onStart}
            onRestart={props.onRestart}
            onStop={props.onStop}
          />
          {selected.snapshot === undefined ? (
            <DrawerLine>
              <text fg={theme.meta}>Not started. Press s to start it.</text>
            </DrawerLine>
          ) : (
            <OutputSection
              log={props.log}
              cells={cells}
              jumpPress={press(props.scroll?.handleJumpToEnd)}
              {...(props.scroll === undefined ? {} : { scroll: props.scroll })}
            />
          )}
        </box>
      )}
    </SideDrawer>
  )
}
