import type { ThreadId } from '@dltech/atlas-core'
import type { TurnLedgerPort, TurnSpend } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'

export type ThreadSpend = { turns: readonly TurnSpend[] }

const UNREADABLE = 'what this conversation has spent could not be read'

const TREE_UNWALKABLE = 'what sub-agents spent could not be counted'

/**
 * The header counter answers for the session, so the read is the thread tree's: a sub-agent's
 * turns are the conversation's money as much as its own are. A tree that cannot be walked — a
 * supervision chain deeper than the traversal follows — degrades to the thread's own rows, which
 * are real figures rather than a guess. A conversation must open regardless: the transcript is
 * the product and the cost is a note beside it. What it must never do is fall back to a figure,
 * because zero would read as a free turn.
 */
export async function readThreadSpend(args: {
  ledger: TurnLedgerPort
  threadId: ThreadId
}): Promise<ThreadSpend> {
  try {
    const tree = await args.ledger.forThreadTree({ threadId: args.threadId })
    return { turns: [...tree.own, ...tree.delegated] }
  } catch {
    notify({ key: 'spend-ledger', text: TREE_UNWALKABLE, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
    try {
      return { turns: await args.ledger.forThread({ threadId: args.threadId }) }
    } catch {
      notify({ key: 'spend-ledger', text: UNREADABLE, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
      return { turns: [] }
    }
  }
}
