import { EWireRotationPhase } from '@dltech/atlas-wire'
import React from 'react'

import { wrapWords } from '../text-flow'
import { theme } from '../theme'
import { BottomDrawer, DrawerLine, DRAWER_INSET } from './drawer'
import { Spans } from './spans'
import { EWorkingVerb, WorkingLine } from './working-line'

export type Rotating = { startedAt: number; phase: EWireRotationPhase }

const INSET = DRAWER_INSET

const NARROWEST = 24

const HEADING = 'ROTATING'

const EXPLANATION =
  'Handing this conversation to a fresh main thread with a summary of what happened so far. Anything you type now is queued and lands on the new thread.'

const PHASE_LINE: Record<EWireRotationPhase, string> = {
  [EWireRotationPhase.Settling]: 'Letting the current step finish…',
  [EWireRotationPhase.Preparing]: 'Writing the handoff summary…',
  [EWireRotationPhase.Writing]: 'Committing the new main thread…',
  [EWireRotationPhase.Activating]: 'Starting the new main thread…',
  [EWireRotationPhase.Failed]: 'The rotation did not complete.',
}

export function RotatingOverlay(props: {
  rotating: Rotating
  now: number
  width: number
}): React.ReactNode {
  const inner = Math.max(NARROWEST, props.width - INSET)
  const said = wrapWords({ text: EXPLANATION, width: inner })

  return (
    <BottomDrawer overlay>
      <DrawerLine>
        <text>
          <Spans spans={[{ text: HEADING, fg: theme.meta }]} />
        </text>
      </DrawerLine>
      <DrawerLine>
        <WorkingLine
          elapsedMs={Math.max(0, props.now - props.rotating.startedAt)}
          outputTokens={0}
          interrupting={false}
          verb={EWorkingVerb.Rotating}
        />
      </DrawerLine>
      <DrawerLine>
        <text fg={theme.dim}>{PHASE_LINE[props.rotating.phase]}</text>
      </DrawerLine>
      <box height={1} flexShrink={0} />
      {said.map((line) => (
        <DrawerLine key={line}>
          <text fg={theme.hint}>{line}</text>
        </DrawerLine>
      ))}
    </BottomDrawer>
  )
}
