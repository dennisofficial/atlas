import { INBOX_KIND_RECORD, inboxEventPayloadOf, isSettledStatus } from '@dltech/atlas-core'

import { postIn } from './inbox-ops'
import type { LeaseOps } from './lease-ops'
import type { ControlSessionRow, ControlStorePort, ControlTx } from './port'
import { archiveIn } from './session-ops'
import { readSessionBusyWithCatchUp } from './session-view-read'

export type SpawnedArchive =
  | { archived: true; archivedAt: string; already: boolean }
  | { refused: string }

const unknownInProject = (sessionId: string): SpawnedArchive => ({
  refused: `there is no session ${sessionId} in this project`,
})

const notSpawnedHere = (sessionId: string): SpawnedArchive => ({
  refused: `session ${sessionId} was not spawned by this session, so only the operator can archive it`,
})

const stillWorking = (sessionId: string): SpawnedArchive => ({
  refused: `session ${sessionId} is still working; message it with send_message or wait until it is idle`,
})

const alreadyArchivedOf = (target: ControlSessionRow): SpawnedArchive | undefined =>
  target.archivedAt === null
    ? undefined
    : { archived: true, archivedAt: target.archivedAt, already: true }

const spawnerRefusalOf = (args: {
  caller: ControlSessionRow
  sessionId: string
  target: ControlSessionRow | undefined
}): SpawnedArchive | undefined => {
  const { caller, sessionId, target } = args
  if (target === undefined || target.userId !== caller.userId) return unknownInProject(sessionId)
  if (target.spawnedBySessionId !== caller.sessionId) return notSpawnedHere(sessionId)
  return undefined
}

export const archiveSpawnedOf = async (params: {
  store: ControlStorePort
  leases: LeaseOps
  nowIn: (tx: ControlTx) => Promise<string>
  fromSessionId: string
  sessionId: string
}): Promise<SpawnedArchive> => {
  const caller = await params.store.transact((tx) =>
    tx.readSession({ sessionId: params.fromSessionId }),
  )
  if (caller === undefined) throw new Error(`unknown session ${params.fromSessionId}`)
  const target = await params.store.transact((tx) =>
    tx.readSession({ sessionId: params.sessionId }),
  )
  const refusal = spawnerRefusalOf({ caller, sessionId: params.sessionId, target })
  if (refusal !== undefined) return refusal
  if (target === undefined) return unknownInProject(params.sessionId)
  const archived = alreadyArchivedOf(target)
  if (archived !== undefined) return archived

  const busy = await readSessionBusyWithCatchUp({
    store: params.store,
    leases: params.leases,
    nowIn: params.nowIn,
    sessionId: params.sessionId,
    threadId: target.mainThreadId,
  })
  if (!isSettledStatus(busy.status.state)) return stillWorking(params.sessionId)

  return params.store.transact(async (tx) => {
    const at = await params.nowIn(tx)
    const locked = await tx.lockSession(params.sessionId)
    const relocked = spawnerRefusalOf({ caller, sessionId: params.sessionId, target: locked })
    if (relocked !== undefined) return relocked
    const meanwhile = locked === undefined ? undefined : alreadyArchivedOf(locked)
    if (meanwhile !== undefined) return meanwhile
    await archiveIn({ tx, sessionId: params.sessionId, archivedAt: at, at })
    await postIn({
      tx,
      sessionId: params.sessionId,
      kind: INBOX_KIND_RECORD,
      payload: inboxEventPayloadOf({
        event: {
          type: 'session-archived',
          bySessionId: caller.sessionId,
          ...(caller.title === null ? {} : { byTitle: caller.title }),
        },
        clientId: `session-archived:${params.sessionId}`,
      }),
      at,
      senderSessionId: caller.sessionId,
    })
    return { archived: true, archivedAt: at, already: false }
  })
}
