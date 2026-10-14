import React from 'react'

import { EBirthNode, type ArchiveBuildProgress } from '@dltech/atlas-harness'

import {
  EStepMark,
  moveHeading,
  type ContainerMove,
  type MoveRow,
} from '../../composition/container-move'
import { serveStageOf } from '../../composition/container-move-birth'
import { wrapWords } from '../text-flow'
import { formatElapsed, theme } from '../theme'
import {
  BottomDrawer,
  DrawerGap,
  DrawerHeading,
  DrawerHints,
  DrawerLine,
  drawerCells,
  DRAWER_INSET,
} from './drawer'
import { ShimmerLine } from './shimmer-line'
import { Spans, type Span } from './spans'
import { formatBytes, transferSpans } from './transfer-meter'

const NARROWEST = 24

const rowSpans = (row: MoveRow): readonly Span[] => {
  if (row.mark === EStepMark.Done) {
    return [
      { text: '✓ ', fg: theme.ok },
      { text: row.text, fg: theme.dim },
    ]
  }
  if (row.mark === EStepMark.Failed) {
    return [
      { text: '✗ ', fg: theme.error },
      { text: row.text, fg: theme.error },
    ]
  }

  return [
    { text: '· ', fg: theme.dim },
    { text: row.text, fg: theme.dim },
  ]
}

const BUILD_VERB: Record<ArchiveBuildProgress['phase'], string> = {
  walking: 'scanning workspace',
  staging: 'capturing workspace',
  compressing: 'compressing workspace',
}

export function buildSpans(build: ArchiveBuildProgress): readonly Span[] {
  const files = `${build.files.toLocaleString('en-US')} ${build.files === 1 ? 'file' : 'files'}`
  const size =
    build.totalBytes === undefined
      ? build.bytes > 0
        ? ` / ${formatBytes(build.bytes)}`
        : ''
      : ` / ${formatBytes(build.bytes)} of ${formatBytes(build.totalBytes)}`
  return [
    { text: '    ' },
    { text: `${BUILD_VERB[build.phase]} — `, fg: theme.meta },
    { text: `${files}${size}`, fg: theme.dim },
  ]
}

function ProgressLines(props: { move: ContainerMove; row: MoveRow }): React.ReactNode {
  const { move, row } = props
  if (row.mark !== EStepMark.Active) return null
  const build = row.nodeIds.includes(EBirthNode.CaptureWorkspace) ? move.build : undefined
  const serve = serveStageOf(row)

  return (
    <>
      {build === undefined ? null : (
        <DrawerLine>
          <text>
            <Spans spans={buildSpans(build)} />
          </text>
        </DrawerLine>
      )}
      {serve === null ? null : (
        <DrawerLine>
          <text>
            <Spans spans={[{ text: '    ' }, { text: serve, fg: theme.meta }]} />
          </text>
        </DrawerLine>
      )}
    </>
  )
}

function ElapsedLine(props: { elapsedMs: number }): React.ReactNode {
  return (
    <DrawerLine>
      <text>
        <Spans
          spans={[
            { text: 'elapsed ', fg: theme.dim },
            { text: formatElapsed(Math.max(0, props.elapsedMs)), fg: theme.warn },
          ]}
        />
      </text>
    </DrawerLine>
  )
}

function TransferLines(props: { row: MoveRow; cells: number }): React.ReactNode {
  if (props.row.mark === EStepMark.Done) return null

  return (props.row.transfers ?? []).map((transfer) => (
    <DrawerLine key={`${transfer.nodeId}:${transfer.transferId}`}>
      <text>
        <Spans spans={transferSpans({ transfer, cells: props.cells })} />
      </text>
    </DrawerLine>
  ))
}

function RowLine(props: { move: ContainerMove; row: MoveRow; elapsedMs: number; cells: number }): React.ReactNode {
  const { row } = props

  if (row.mark === EStepMark.Active) {
    return (
      <>
        <DrawerLine>
          <ShimmerLine label={`${row.text} (${formatElapsed(Math.max(0, props.elapsedMs))})`} />
        </DrawerLine>
        <ProgressLines move={props.move} row={row} />
        <TransferLines row={row} cells={props.cells} />
      </>
    )
  }

  return (
    <>
      <DrawerLine>
        <text>
          <Spans spans={rowSpans(row)} />
        </text>
      </DrawerLine>
      <TransferLines row={row} cells={props.cells} />
    </>
  )
}

export function ContainerMoveOverlay(props: {
  move: ContainerMove
  now: number
  width: number
  onDismiss: () => void
}): React.ReactNode {
  const { move } = props
  const inner = Math.max(NARROWEST, props.width - DRAWER_INSET)
  const reason = move.failure === null ? [] : wrapWords({ text: move.failure, width: inner })

  return (
    <BottomDrawer overlay>
      <DrawerHeading label={move.heading ?? moveHeading(move.target)} />
      {move.cancellable === true && move.failure === null ? (
        <ElapsedLine elapsedMs={props.now - move.startedAt} />
      ) : null}
      {move.rows.map((row) => (
        <RowLine
          key={row.id}
          move={move}
          row={row}
          elapsedMs={props.now - move.activeSince}
          cells={drawerCells({ width: props.width })}
        />
      ))}
      {move.failure === null && move.cancellable === true ? (
        <>
          <DrawerGap />
          <DrawerHints
            hints={[{ key: 'esc', label: 'cancel and keep the draft' }]}
            cells={drawerCells({ width: props.width })}
            onDismiss={props.onDismiss}
          />
        </>
      ) : null}
      {move.failure === null ? null : (
        <>
          <DrawerGap />
          {reason.map((line) => (
            <DrawerLine key={line}>
              <text fg={theme.error}>{line}</text>
            </DrawerLine>
          ))}
          <DrawerHints
            hints={[{ key: 'esc', label: 'carry on' }]}
            cells={drawerCells({ width: props.width })}
            onDismiss={props.onDismiss}
          />
        </>
      )}
    </BottomDrawer>
  )
}
