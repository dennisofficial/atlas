import type { Attachment, RecordEvent } from '@dltech/atlas-core'
import { ALREADY_SENT_REASON, EStagedOutcome, stagedOutcomesOf } from '@dltech/atlas-client/stream'

export type StagedSend = { clientId: string; text: string; attachments: readonly Attachment[] }

export type StagedRestore = { text: string; attachments: readonly Attachment[] }

export type StagedSettlement = {
  kept: StagedSend[]
  restored: StagedRestore[]
  notices: string[]
}

export const clientIdOfSend = (args: { retry: string | undefined; mint: () => string }): string =>
  args.retry ?? args.mint()

export const mergeIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`

export const settlementOf = (args: {
  staged: readonly StagedSend[]
  events: readonly RecordEvent[]
  unread?: ReadonlySet<string> | undefined
}): StagedSettlement => {
  const unread = args.unread ?? new Set<string>()
  const outcomes = stagedOutcomesOf({
    events: args.events,
    clientIds: args.staged.map((entry) => entry.clientId),
  })
  const settlement: StagedSettlement = { kept: [], restored: [], notices: [] }
  for (const entry of args.staged) {
    const outcome = outcomes.get(entry.clientId)
    if (outcome === undefined || outcome.outcome === EStagedOutcome.Pending) {
      settlement.kept.push(entry)
      continue
    }
    if (outcome.outcome === EStagedOutcome.Posted) {
      if (unread.has(entry.clientId)) settlement.kept.push(entry)
      continue
    }
    if (outcome.reason === ALREADY_SENT_REASON) {
      settlement.notices.push('Already sent')
      continue
    }
    settlement.restored.push({ text: entry.text, attachments: entry.attachments })
    if (outcome.reason !== undefined) settlement.notices.push(outcome.reason)
  }
  return settlement
}

export const draftAfterSettlementOf = (args: {
  restored: readonly string[]
  draft: string
}): string =>
  args.restored.reduce((draft, withdrawn) => mergeIntoDraft({ withdrawn, draft }), args.draft)
