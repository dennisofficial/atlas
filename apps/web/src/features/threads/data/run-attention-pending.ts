import { ERunRemedy, type RunId } from '@dltech/atlas-core'

export type PendingRemedy = ERunRemedy.Retry | ERunRemedy.Resume

export type PendingAction = { remedy: PendingRemedy; key: string }

export const PENDING_LABELS: Record<PendingRemedy, string> = {
  [ERunRemedy.Retry]: 'Retrying…',
  [ERunRemedy.Resume]: 'Resuming…',
}

export const isPendingRemedy = (remedy: ERunRemedy): remedy is PendingRemedy =>
  remedy === ERunRemedy.Retry || remedy === ERunRemedy.Resume

export const attentionKeyOf = (args: { failureSeq: number | null; runId: RunId | null }): string =>
  `${args.failureSeq ?? 'none'}:${args.runId ?? 'none'}`

export const activePendingOf = (args: {
  pending: PendingAction | null
  key: string | null
  working: boolean
}): PendingRemedy | null => {
  const { pending, key, working } = args
  if (pending === null || working || key === null || pending.key !== key) return null
  return pending.remedy
}
