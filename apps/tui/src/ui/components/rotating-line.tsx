import { ERotationPhase } from '@dltech/atlas-harness'
import React from 'react'

import { formatElapsed } from '../theme'
import { ShimmerLine } from './shimmer-line'

export type Rotating = { startedAt: number; phase: ERotationPhase }

const PHASE_LABEL: Record<ERotationPhase, string> = {
  [ERotationPhase.Settling]: 'letting the current step finish',
  [ERotationPhase.Summarising]: 'writing the carry-over brief',
  [ERotationPhase.Compacting]: 'folding it into the window',
  [ERotationPhase.Done]: 'finishing up',
  [ERotationPhase.Failed]: 'stopping',
}

export function RotatingLine(props: { rotating: Rotating; now: number }): React.ReactNode {
  const elapsed = formatElapsed(Math.max(0, props.now - props.rotating.startedAt))
  const label = `Rotating · ${PHASE_LABEL[props.rotating.phase]} for ${elapsed} (esc to cancel)`

  return (
    <box flexDirection="column">
      <ShimmerLine label={label} />
    </box>
  )
}
