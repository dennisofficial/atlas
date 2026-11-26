import { createHash, randomUUID } from 'node:crypto'

import type { ControlPlane } from '@dltech/atlas-control'
import { refKey, toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { PodSessions } from '@dltech/atlas-plugin-sdk'

import type { ParkArchivedPod } from './park-archived'
import type { RoleModelChoice } from './ports'
import type { HostStepPort } from './record/host-step'

const uuidOf = (seed: string): string => {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const derivedIdsOf = (args: {
  spawnerSessionId: string
  threadId: ThreadId
  stepKey: string
}): { sessionId: string; mainThreadId: string } => {
  const seed = [args.spawnerSessionId, args.threadId, args.stepKey].join(':')
  return { sessionId: uuidOf(`${seed}:session`), mainThreadId: uuidOf(`${seed}:thread`) }
}

export const podSessionsOf = (args: {
  plane: ControlPlane
  sessionId: string
  model: () => RoleModelChoice
  threadId?: ThreadId | undefined
  step?: HostStepPort | undefined
  onFallback?: ((args: { agentId: ThreadId; model: RoleModelChoice }) => Promise<void>) | undefined
  parkArchived?: ParkArchivedPod | undefined
}): PodSessions => ({
  spawn: async ({ title, brief, nested, files }) => {
    const model = args.model()
    const step = await args.step?.({ op: 'sessions.spawn', input: { title, brief, nested, files } })
    const ids =
      step === undefined || args.threadId === undefined
        ? { sessionId: randomUUID(), mainThreadId: randomUUID() }
        : derivedIdsOf({
            spawnerSessionId: args.sessionId,
            threadId: args.threadId,
            stepKey: step.key,
          })
    const spawned = await args.plane.spawnPeer({
      spawnerSessionId: args.sessionId,
      sessionId: ids.sessionId,
      mainThreadId: ids.mainThreadId,
      modelRef: refKey(model.ref),
      modelEffort: model.effort,
      modelFast: model.fast,
      title,
      brief,
      nested,
      ...(files === undefined ? {} : { files }),
    })
    if ('refused' in spawned) throw new Error(spawned.refused)
    if (model.unavailable !== undefined) {
      await args.onFallback?.({ agentId: toThreadId(ids.mainThreadId), model })
    }
    return ids
  },
  archive: async ({ sessionId }) => {
    const archived = await args.plane.archiveSpawned({ fromSessionId: args.sessionId, sessionId })
    if ('refused' in archived) return { refused: archived.refused }
    if (!archived.already) await args.parkArchived?.({ sessionId })
    return { archived: true, already: archived.already }
  },
  list: async () => {
    const roster = await args.plane.sessionsOf({ sessionId: args.sessionId })
    return roster.sessions.map((row) => ({
      sessionId: row.sessionId,
      title: row.title,
      spawnedBy: row.spawnedBySessionId,
      nested: row.nested,
      archivedAt: row.archivedAt,
      current: row.sessionId === args.sessionId,
      status: row.view?.status ?? null,
    }))
  },
  teammates: async () => {
    const roster = await args.plane.sessionsOf({ sessionId: args.sessionId })
    return roster.sessions
      .filter((row) => row.spawnedBySessionId === args.sessionId && row.nested)
      .map((row) => ({
        sessionId: row.sessionId,
        title: row.title,
        spawnedBy: row.spawnedBySessionId,
        nested: row.nested,
        archivedAt: row.archivedAt,
        current: false,
        status: row.view?.status ?? null,
      }))
  },
})
