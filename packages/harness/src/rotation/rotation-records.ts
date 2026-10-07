import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { ClockPort, ThreadId } from '@dltech/atlas-core'

import { readMetaSync, sessionMetaSchema } from '../store/sessions/meta'
import {
  ERotationStatus,
  type RotationRecord,
  type SessionAuthorityPort,
  type SessionMeta,
} from '../store/sessions/meta'
import { contextDirectory, sessionMetaFile } from '../store/sessions/paths'
import type { SessionRegistry } from '../store/sessions/registry'

export function rotationRecordOf(args: {
  predecessor: ThreadId
  successor: ThreadId
  handoffPath: string
  watermark: number
  status: ERotationStatus
  operationId: string
  clock: ClockPort
}): RotationRecord {
  return {
    predecessor: args.predecessor,
    successor: args.successor,
    handoffPath: args.handoffPath,
    watermarkSeq: args.watermark,
    operationId: args.operationId,
    status: args.status,
    updatedAt: args.clock.now(),
  }
}

export type RotationStore = {
  recordOf: (args: { sessionId: string }) => Promise<RotationRecord | undefined>
  writeRecord: (args: { sessionId: string; write: Parameters<SessionAuthorityPort['writeRotation']>[0]['write'] }) => Promise<void>
  markFailed: (args: { sessionId: string; predecessor: ThreadId }) => Promise<void>
  handoffPathFor: (args: { sessionId: string; operationId: string }) => Promise<{ dir: string; path: string }>
  persistHandoff: (args: { path: string; dir: string; contents: string }) => Promise<void>
}

export function rotationStore(deps: {
  authority: SessionAuthorityPort
  registry: SessionRegistry
  clock: ClockPort
}): RotationStore {
  const readSessionMeta = async ({ sessionId }: { sessionId: string }): Promise<SessionMeta | undefined> => {
    const sessionDir = await deps.registry.sessionDirFor({ threadId: sessionId as ThreadId })
    return readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
  }

  return {
    recordOf: async ({ sessionId }) => {
      const meta = await readSessionMeta({ sessionId })
      return meta?.rotation ?? undefined
    },

    writeRecord: async ({ sessionId, write }) => {
      await deps.authority.writeRotation({ sessionId, write })
    },

    markFailed: async ({ sessionId, predecessor }) => {
      const meta = await readSessionMeta({ sessionId })
      const current = meta?.rotation
      if (current === undefined || current === null || current.status !== ERotationStatus.Preparing) return
      const failed: RotationRecord = {
        ...current,
        status: ERotationStatus.Failed,
        updatedAt: deps.clock.now(),
      }
      await deps.authority
        .writeRotation({ sessionId, write: { rotation: failed, expectedActiveMain: predecessor } })
        .catch(() => undefined)
    },

    handoffPathFor: async ({ sessionId, operationId }) => {
      const sessionDir = await deps.registry.sessionDirFor({ threadId: sessionId as ThreadId })
      const dir = join(contextDirectory({ sessionDir }), 'handoffs')
      return { dir, path: join(dir, `${operationId}.md`) }
    },

    persistHandoff: async ({ path, dir, contents }) => {
      await mkdir(dir, { recursive: true })
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, contents, 'utf8')
      await rename(tmp, path)
    },
  }
}
