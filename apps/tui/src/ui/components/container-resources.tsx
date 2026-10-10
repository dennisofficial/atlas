import React from 'react'

import {
  memoryGbOf,
  SANDBOX_VCPU_STEPS,
  EResourcesPhase,
  type ContainerResourcesState,
} from '../../composition/use-container-resources'
import type { Hint } from '../hint-layout'
import { theme } from '../theme'
import { BottomDrawer, drawerCells, DrawerHints, DrawerLine } from './drawer'
import { clipSpans } from './sidebar/cells'
import { Spans, type Span } from './spans'

const HEADING = 'Sandbox resources'

const SUBTITLE =
  'Resizes the sandbox this conversation runs in — the default for new sandboxes is in settings (ctrl+o)'

const RAM_NOTE = '2 GB per vCPU — RAM moves with the CPU'

const HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'adjust' },
  { key: 'Enter', label: 'apply' },
  { key: 'Esc', label: 'cancel' },
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

function valueRow(state: ContainerResourcesState): Span[] {
  if (state.phase === EResourcesPhase.Loading) {
    return [
      { text: 'CPU  ', fg: theme.meta },
      { text: 'reading the live sandbox…', fg: theme.hint },
    ]
  }
  const at = state.vcpus
  const floor = SANDBOX_VCPU_STEPS[0] ?? 2
  const ceiling = SANDBOX_VCPU_STEPS[SANDBOX_VCPU_STEPS.length - 1] ?? 8
  const applying = state.phase === EResourcesPhase.Applying
  return [
    { text: 'CPU  ', fg: theme.meta },
    { text: at > floor ? '‹ ' : '  ', fg: theme.hint },
    { text: `${at} vCPU`, fg: applying ? theme.hint : theme.accent },
    { text: at < ceiling ? ' ›' : '  ', fg: theme.hint },
    { text: '      RAM  ', fg: theme.meta },
    { text: `${memoryGbOf(at)} GB`, fg: applying ? theme.hint : theme.body },
  ]
}

/**
 * The `/container resources` overlay. One knob — vCPUs — with the RAM it implies beside it; the
 * provider prices and allocates them as a pair. Enter applies to the live sandbox; Esc walks away.
 */
export function ContainerResources(props: {
  width: number
  state: ContainerResourcesState
  overlay?: boolean
  onDismiss: () => void
}): React.ReactNode {
  const cells = drawerCells({ width: props.width })
  const applying = props.state.phase === EResourcesPhase.Applying

  return (
    <BottomDrawer overlay={props.overlay === true}>
      <Line spans={[{ text: HEADING, fg: theme.accent }]} cells={cells} />
      <Line spans={[{ text: SUBTITLE, fg: theme.hint }]} cells={cells} />
      <box height={1} flexShrink={0} />
      <Line spans={valueRow(props.state)} cells={cells} />
      <Line spans={[{ text: RAM_NOTE, fg: theme.hint }]} cells={cells} />
      {props.state.error === null ? null : (
        <Line spans={[{ text: props.state.error, fg: theme.warn }]} cells={cells} />
      )}
      {applying ? <Line spans={[{ text: 'resizing…', fg: theme.hint }]} cells={cells} /> : null}
      <box height={1} flexShrink={0} />
      <DrawerHints hints={HINTS} cells={cells} onDismiss={props.onDismiss} />
    </BottomDrawer>
  )
}
