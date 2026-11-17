import { Marker, MarkerContent } from '@dltech/atlas-ui/components/marker'

import { ETranscriptKind } from '../data/transcript-kind'
import type { WorkItem } from '../data/transcript-turns'

export const STOPPED_LABEL = 'Stopped'

export const workStopped = (items: readonly WorkItem[]): boolean =>
  items.some((item) => item.kind === ETranscriptKind.Thought && item.stopped === true)

export function StoppedLine() {
  return (
    <Marker data-slot="stopped-line" className="text-xs">
      <MarkerContent>{STOPPED_LABEL}</MarkerContent>
    </Marker>
  )
}
