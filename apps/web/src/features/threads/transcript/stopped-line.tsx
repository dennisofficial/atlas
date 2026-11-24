import { Button } from '@dltech/atlas-ui/components/button'
import { Marker, MarkerContent } from '@dltech/atlas-ui/components/marker'
import { resumableOf, type ResumePoint } from '@dltech/atlas-core'

import { ETranscriptKind } from '../data/transcript-kind'
import type { WorkItem } from '../data/transcript-turns'

export const STOPPED_LABEL = 'Stopped'
export const RESUME_LABEL = 'Resume'
export const RESUMING_LABEL = 'Resuming…'

export type TranscriptResume = {
  pending: boolean
  onResume: () => void
}

export const workStopped = (items: readonly WorkItem[]): boolean =>
  items.some((item) => item.kind === ETranscriptKind.Thought && item.stopped === true)

export const workResume = (items: readonly WorkItem[]): ResumePoint | null =>
  items.find(
    (item): item is Extract<WorkItem, { kind: ETranscriptKind.Thought }> =>
      item.kind === ETranscriptKind.Thought && item.stopped === true,
  )?.resume ?? null

export function StoppedLine({
  resume,
  action,
}: {
  resume?: ResumePoint | null | undefined
  action?: TranscriptResume | null | undefined
}) {
  const canResume = action != null && resume != null && resumableOf(resume)
  return (
    <Marker data-slot="stopped-line" className="text-xs">
      <MarkerContent>{STOPPED_LABEL}</MarkerContent>
      {canResume ? (
        <Button
          data-slot="resume-turn"
          variant="ghost"
          size="xs"
          disabled={action.pending}
          onClick={action.onResume}
        >
          {action.pending ? RESUMING_LABEL : RESUME_LABEL}
        </Button>
      ) : null}
    </Marker>
  )
}
