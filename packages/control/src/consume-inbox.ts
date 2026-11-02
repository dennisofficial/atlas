import { consume, type LogHead } from '@dltech/atlas-core'

import type { ControlTx } from './port'
import { AppendAbort } from './refusal'

export async function consumeInbox(params: {
  tx: ControlTx
  sessionId: string
  inboxId: number
  seq: number
  head: LogHead
}): Promise<void> {
  const entry = await params.tx.readInboxEntry({
    sessionId: params.sessionId,
    inboxId: params.inboxId,
  })
  const move = consume({ entry, seq: params.seq })
  if (!move.ok) throw new AppendAbort(move.refusal, params.head)
  const marked = await params.tx.markInboxConsumed({
    sessionId: params.sessionId,
    inboxId: params.inboxId,
    seq: params.seq,
  })
  if (marked) return
  const current = await params.tx.readInboxEntry({
    sessionId: params.sessionId,
    inboxId: params.inboxId,
  })
  const lost = consume({ entry: current, seq: params.seq })
  throw new AppendAbort(lost.ok ? { kind: 'already-consumed' } : lost.refusal, params.head)
}
