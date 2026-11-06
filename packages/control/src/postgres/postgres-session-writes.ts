import type { Tx } from '@dltech/atlas-db'

export const setSessionArchivedIn = async (params: {
  tx: Tx
  sessionId: string
  archivedAt: string | null
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
  }).updateAndCount({
    archivedAt: params.archivedAt === null ? null : new Date(params.archivedAt),
  })
  return changed === 1
}

export const setSessionTitleIfUntitledIn = async (params: {
  tx: Tx
  sessionId: string
  title: string
  fromInboxId: number | null
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
    title: null,
  }).updateAndCount({
    title: params.title,
    titledFromInboxId: params.fromInboxId,
  })
  return changed === 1
}

export const clearTitleFromIn = async (params: {
  tx: Tx
  sessionId: string
  inboxId: number
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
    titledFromInboxId: params.inboxId,
  }).updateAndCount({ title: null, titledFromInboxId: null })
  return changed === 1
}
