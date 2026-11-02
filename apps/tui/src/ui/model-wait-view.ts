import {
  EModelWaitAction,
  lastCheckedLabelOf,
  type ControlOutcomeNote,
  type ModelWaitIssue,
} from '@dltech/atlas-client/transcript'

import { wrapWords } from './text-flow'

export type ModelWaitControlAction = EModelWaitAction.Recheck | EModelWaitAction.RemoveManualPause

export type ModelWaitPending = { key: string; action: EModelWaitAction }

export type ModelWaitControlState = {
  enabled: boolean
  disabledReason: string | undefined
  pending: ModelWaitPending | null
  notes: ReadonlyMap<string, ControlOutcomeNote>
  labelOfThread: (threadId: string) => string
  onAction: (args: { issue: ModelWaitIssue; action: ModelWaitControlAction }) => void
}

export const AFFECTED_SHOWN = 4

export const PROVIDERS_HINT = 'providers: ctrl+a or /auth'

const PENDING_LABEL: Partial<Record<EModelWaitAction, string>> = {
  [EModelWaitAction.Recheck]: 'Rechecking…',
  [EModelWaitAction.RemoveManualPause]: 'Removing pause…',
}

export const isControlAction = (action: EModelWaitAction): action is ModelWaitControlAction =>
  action !== EModelWaitAction.Providers

export const summaryOf = (args: { issue: ModelWaitIssue; cells: number }): string =>
  wrapWords({ text: args.issue.detail, width: args.cells }).join('\n')

export function detailOf(args: {
  issue: ModelWaitIssue
  cells: number
  labelOfThread: (threadId: string) => string
}): string {
  const { issue, cells } = args
  const shown = issue.affectedThreadIds.slice(0, AFFECTED_SHOWN)
  const hidden = issue.affectedThreadIds.length - shown.length
  const affected = shown.flatMap((threadId) =>
    wrapWords({ text: `· ${args.labelOfThread(threadId)}`, width: Math.max(1, cells - 2) }).map(
      (line, index) => `${index === 0 ? '  ' : '    '}${line}`,
    ),
  )
  return [
    lastCheckedLabelOf(issue.lastCheckedAt),
    issue.affectedLabel,
    ...affected,
    ...(hidden > 0 ? [`  … +${hidden} more`] : []),
  ].join('\n')
}

export type WaitActionView = {
  action: ModelWaitControlAction
  label: string
  primary: boolean
  blocked: boolean
  pending: boolean
}

export function actionViewsOf(args: {
  issue: ModelWaitIssue
  control: ModelWaitControlState
}): readonly WaitActionView[] {
  const { issue, control } = args
  const pendingHere = control.pending?.key === issue.key
  return issue.actions
    .filter((spec) => isControlAction(spec.action))
    .flatMap((spec) => {
      if (!isControlAction(spec.action)) return []
      const pending = pendingHere && control.pending?.action === spec.action
      return [
        {
          action: spec.action,
          label: pending ? (PENDING_LABEL[spec.action] ?? spec.label) : spec.label,
          primary: spec.primary,
          blocked: !control.enabled || pendingHere,
          pending,
        },
      ]
    })
}

export const hasProvidersAction = (issue: ModelWaitIssue): boolean =>
  issue.actions.some((spec) => spec.action === EModelWaitAction.Providers)
