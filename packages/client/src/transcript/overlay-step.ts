import { EBlockKind } from '@dltech/atlas-core'
import { EStreamBlockKind } from '@dltech/atlas-protocol'

import { EStepEnd, toStepId } from '../channel'
import type { OpenOverlay, OverlayBlock } from '../stream'
import type { InFlightStep, StepBlock } from './in-flight-steps'

const blockKindOf = (kind: EStreamBlockKind): EBlockKind => {
  switch (kind) {
    case EStreamBlockKind.Text:
      return EBlockKind.Text
    case EStreamBlockKind.Reasoning:
      return EBlockKind.Reasoning
  }
}

const stepBlockOf = (block: OverlayBlock): StepBlock => ({
  id: block.block,
  kind: blockKindOf(block.kind),
  text: block.text,
})

export const overlayStepOf = (open: OpenOverlay | undefined): InFlightStep[] => {
  if (open === undefined) return []
  const { runId, step, attempt } = open.key
  return [
    {
      stepId: toStepId(`${runId}:${step}:${attempt}`),
      blocks: open.blocks.map(stepBlockOf),
      calls: [],
      end: open.ended ? EStepEnd.Completed : null,
      supersededBy: null,
      errorMessage: null,
    },
  ]
}
