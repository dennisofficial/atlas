import type { PendingInputsState } from '@dltech/atlas-core'
import { EMessageOrigin } from '@dltech/atlas-core'
import { pendingMessagesOf } from '@dltech/atlas-core'

import { EPendingKind, type PendingRow } from '../store'
import type { StagedMessage } from './staged-messages'

const sendingRows = (messages: readonly StagedMessage[], failed: boolean): readonly PendingRow[] =>
  messages.map((message) => ({
    kind: EPendingKind.Sending,
    id: message.clientId,
    text: message.text,
    failed,
  }))

export const pendingRowsOf = (args: {
  pending: PendingInputsState
  staged: readonly StagedMessage[]
  refused: readonly StagedMessage[]
  working: boolean
}): readonly PendingRow[] => {
  const shown = new Set([
    ...args.staged.map((message) => message.clientId),
    ...args.refused.map((message) => message.clientId),
  ])

  const queued = pendingMessagesOf(args.pending).flatMap((input): readonly PendingRow[] => {
    const clientId = input.message?.clientId
    if (clientId !== undefined && shown.has(clientId)) return []
    const via = input.message?.via
    return [
      {
        kind: EPendingKind.Operator,
        id: String(input.inboxId),
        text: input.message?.text ?? '',
        ...(via === undefined || via === EMessageOrigin.Operator ? {} : { editable: false }),
      },
    ]
  })

  return [...sendingRows(args.staged, false), ...sendingRows(args.refused, true), ...queued]
}
