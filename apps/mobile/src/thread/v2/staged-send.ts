import type { V2Event } from '@dltech/atlas-core'
import { ALREADY_SENT_REASON, EStagedOutcome, stagedOutcomesOf } from '@dltech/atlas-client/stream'

export type StagedSend = { clientId: string; text: string }

export type StagedSettlement = {
  kept: StagedSend[]
  restored: string[]
  notices: string[]
}

export const clientIdOfSend = (args: { retry: string | undefined; mint: () => string }): string =>
  args.retry ?? args.mint()

export const mergeIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`

export const settlementOf = (args: {
  staged: readonly StagedSend[]
  events: readonly V2Event[]
}): StagedSettlement => {
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
    if (outcome.outcome === EStagedOutcome.Posted) continue
    if (outcome.reason === ALREADY_SENT_REASON) {
      settlement.notices.push('Already sent')
      continue
    }
    settlement.restored.push(entry.text)
    if (outcome.reason !== undefined) settlement.notices.push(outcome.reason)
  }
  return settlement
}

export const draftAfterSettlementOf = (args: {
  restored: readonly string[]
  draft: string
}): string =>
  args.restored.reduce((draft, withdrawn) => mergeIntoDraft({ withdrawn, draft }), args.draft)
