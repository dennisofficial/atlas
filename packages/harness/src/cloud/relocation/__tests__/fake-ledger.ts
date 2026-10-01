import type { ThreadId } from '@dltech/atlas-core'

import type { TurnLedgerPort, TurnSpend } from '../../../ledger/turn-ledger.port'

export type FakeLedger = TurnLedgerPort & {
  readonly rows: readonly TurnSpend[]
}

export function fakeLedger(
  args: {
    spent?: readonly TurnSpend[]
    children?: Readonly<Record<string, readonly ThreadId[]>>
  } = {},
): FakeLedger {
  const rows: TurnSpend[] = [...(args.spent ?? [])]

  return {
    get rows() {
      return rows
    },
    record: async (spend) => {
      rows.push(spend)
    },
    forThread: async ({ threadId }) => rows.filter((row) => row.threadId === threadId),

    forThreadTree: async ({ threadId }) => {
      const children = new Set<string>(args.children?.[threadId] ?? [])

      return {
        own: rows.filter((row) => row.threadId === threadId),
        delegated: rows.filter((row) => children.has(row.threadId)),
      }
    },
  }
}
