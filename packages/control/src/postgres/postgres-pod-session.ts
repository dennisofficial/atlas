import type { Tx } from '@dltech/atlas-db'

import { UnknownThreadError } from '../errors'

type PodOwner = { id: string; podSessionId: string | null }

const owningSessionIn = async (args: { tx: Tx; threadId: string }): Promise<PodOwner | null> => {
  const main = await args.tx.orm.v2.V2Session.where({ mainThreadId: args.threadId })
    .select('id', 'podSessionId')
    .first()
  if (main !== null) return main
  const thread = await args.tx.orm.v2.V2Thread.where({ id: args.threadId })
    .select('sessionId')
    .first()
  if (thread === null) return null
  return await args.tx.orm.v2.V2Session.where({ id: thread.sessionId })
    .select('id', 'podSessionId')
    .first()
}

export const podSessionIdOfThreadIn = async (args: {
  tx: Tx
  threadId: string
}): Promise<string> => {
  const session = await owningSessionIn(args)
  if (session === null) throw new UnknownThreadError(args.threadId)
  return session.podSessionId ?? session.id
}
