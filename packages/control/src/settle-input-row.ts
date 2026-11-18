import type { V2Event } from '@dltech/atlas-core'

import type { ControlTx } from './port'

const markLogged = async (params: {
  tx: ControlTx
  sessionId: string
  inboxId: number | undefined
  seq: number
}): Promise<void> => {
  if (params.inboxId === undefined) return
  await params.tx.markInboxConsumed({
    sessionId: params.sessionId,
    inboxId: params.inboxId,
    seq: params.seq,
  })
}

export const settleInputRow = async (params: {
  tx: ControlTx
  sessionId: string
  event: V2Event
}): Promise<void> => {
  const { tx, sessionId, event } = params
  const mark = (inboxId: number | undefined): Promise<void> =>
    markLogged({ tx, sessionId, inboxId, seq: event.seq })
  switch (event.type) {
    case 'input-posted':
    case 'input-consumed':
      await mark(event.inboxId)
      return
    case 'input-withdrawn':
      await tx.deleteInboxEntry({ sessionId, inboxId: event.inboxId })
      await mark(event.requestInboxId)
      await tx.clearTitleFrom({ sessionId, inboxId: event.inboxId })
      return
    case 'input-refused':
      await mark(event.inboxId)
      await mark(event.targetInboxId)
      return
    default:
      return
  }
}
