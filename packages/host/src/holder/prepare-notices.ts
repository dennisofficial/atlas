import {
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
  type EventDraft,
  type V2Event,
} from '@dltech/atlas-core'

import type { BootNotice } from './ports'
import type { SessionRecord } from './record/record-adapter'

const BOOT_CONTEXT_KEY = 'boot'

export const bootDraftOf = (notice: BootNotice): EventDraft => ({
  type: 'context-loaded',
  slot: notice.slot,
  key: BOOT_CONTEXT_KEY,
  content: notice.content,
})

export const setupNoticesOf = (record: SessionRecord): ReadonlySet<ESetupPhase> => {
  const events = record.eventCache().eventsAfter(0)
  const runStart = (event: V2Event): boolean =>
    event.type === 'workspace-step' &&
    event.step === EWorkspaceStep.Setup &&
    event.state === EWorkspaceStepState.Started
  const reports = events.slice(events.findLastIndex(runStart) + 1)
  return new Set(
    reports.flatMap((event) =>
      event.type === 'sandbox-setup-reported' && event.phase !== undefined ? [event.phase] : [],
    ),
  )
}
