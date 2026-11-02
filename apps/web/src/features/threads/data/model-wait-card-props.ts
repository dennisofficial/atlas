import {
  controlFailureNoteOf,
  controlOutcomeNoteOf,
  EControlOutcomeTone,
  EModelWaitAction,
  lastCheckedLabelOf,
  modelWaitAnnouncementOf,
  MODEL_WAIT_PARTIAL_NOTE,
  RECHECK_CHARGE_WARNING,
  type ControlOutcomeNote,
  type ModelWaitIssue,
  type ModelWaitView,
} from '@dltech/atlas-client/transcript'
import type { EAvailabilityControlResult } from '@dltech/atlas-client/channel'
import {
  EModelWaitNoteTone,
  type ModelWaitAction,
  type ModelWaitCardProps,
  type ModelWaitIssueView,
} from '@dltech/atlas-ui/ai/model-wait-card'

export type IssueNote = ControlOutcomeNote

export type ModelWaitPending = { key: string; action: EModelWaitAction }

export type ModelWaitControls = {
  enabled: boolean
  disabledReason: string | undefined
  pending: ModelWaitPending | null
  notes: ReadonlyMap<string, IssueNote>
  labelOfThread: (threadId: string) => string
  onOpenThread: (threadId: string) => (() => void) | undefined
  onAction: (args: { issue: ModelWaitIssue; action: EModelWaitAction }) => void
}

const NOTE_TONE: Record<EControlOutcomeTone, EModelWaitNoteTone> = {
  [EControlOutcomeTone.Done]: EModelWaitNoteTone.Done,
  [EControlOutcomeTone.Info]: EModelWaitNoteTone.Info,
  [EControlOutcomeTone.Retry]: EModelWaitNoteTone.Retry,
  [EControlOutcomeTone.Error]: EModelWaitNoteTone.Error,
}

const PENDING_LABEL: Partial<Record<EModelWaitAction, string>> = {
  [EModelWaitAction.Recheck]: 'Rechecking…',
  [EModelWaitAction.RemoveManualPause]: 'Removing pause…',
}

export const noteOfResult = (result: EAvailabilityControlResult): IssueNote =>
  controlOutcomeNoteOf(result)

export const noteOfFailure = (failure: unknown): IssueNote => controlFailureNoteOf(failure)

function actionOf(args: {
  issue: ModelWaitIssue
  spec: ModelWaitIssue['actions'][number]
  controls: ModelWaitControls
}): ModelWaitAction {
  const { issue, spec, controls } = args
  const controlling = spec.action !== EModelWaitAction.Providers
  const pendingHere = controls.pending?.key === issue.key
  const isPending = pendingHere && controls.pending?.action === spec.action
  const blocked = controlling && (!controls.enabled || pendingHere)
  const pendingLabel = PENDING_LABEL[spec.action]
  return {
    id: spec.action,
    label: spec.label,
    primary: spec.primary,
    disabled: blocked,
    ...(controls.disabledReason === undefined || !controlling
      ? {}
      : { disabledReason: controls.disabledReason }),
    ...(isPending ? { pending: true } : {}),
    ...(isPending && pendingLabel !== undefined ? { pendingLabel } : {}),
    ...(spec.action === EModelWaitAction.Recheck
      ? {
          confirm: {
            title: 'Recheck access?',
            description: RECHECK_CHARGE_WARNING,
            confirmLabel: 'Recheck and continue',
          },
        }
      : {}),
    onSelect: () => controls.onAction({ issue, action: spec.action }),
  }
}

function issueViewOf(args: {
  issue: ModelWaitIssue
  controls: ModelWaitControls
}): ModelWaitIssueView {
  const { issue, controls } = args
  const note = controls.notes.get(issue.key)
  return {
    id: issue.key,
    detail: issue.detail,
    meta: lastCheckedLabelOf(issue.lastCheckedAt),
    affectedLabel: issue.affectedLabel,
    affected: issue.affectedThreadIds.map((threadId) => {
      const onOpen = controls.onOpenThread(threadId)
      return {
        id: threadId,
        label: controls.labelOfThread(threadId),
        ...(onOpen === undefined ? {} : { onOpen }),
      }
    }),
    actions: issue.actions.map((spec) => actionOf({ issue, spec, controls })),
    ...(note === undefined ? {} : { note: { tone: NOTE_TONE[note.tone], text: note.text } }),
  }
}

export function modelWaitCardPropsOf(args: {
  view: ModelWaitView
  controls: ModelWaitControls
}): ModelWaitCardProps {
  const { view, controls } = args
  return {
    title: view.title,
    announcement: modelWaitAnnouncementOf(view),
    issues: view.issues.map((issue) => issueViewOf({ issue, controls })),
    ...(view.partial ? { partialNote: MODEL_WAIT_PARTIAL_NOTE } : {}),
  }
}
