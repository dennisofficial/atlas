import { EExecutionLocation, executionLocationOf, type ClockPort, type ThreadId } from '@dltech/atlas-core'

import type { SupervisedAgent } from '../thread-store'
import { newThreadMeta, readMetaSync, sessionMetaSchema, type ThreadMeta } from './meta'
import { sessionDirectory, sessionMetaFile } from './paths'
import type { CreateArgs, ThreadStoreContext } from './thread-store-context'

export function blankMeta({ clock, threadId, fields }: { clock: ClockPort; threadId: ThreadId; fields: CreateArgs }): ThreadMeta {
  const meta = newThreadMeta({ id: threadId, at: clock.now() })
  if (fields.title !== undefined) meta.title = fields.title
  if (fields.workspace !== undefined) meta.workspace = fields.workspace
  if (fields.repo !== undefined) meta.repo = fields.repo
  if (fields.executionLocation !== undefined) meta.executionLocation = fields.executionLocation
  if (fields.model !== undefined) {
    meta.modelRef = fields.model.ref
    meta.modelEffort = fields.model.effort
  }
  if (fields.agent !== undefined) {
    meta.spawnerThreadId = fields.agent.spawnedBy
    meta.agentType = fields.agent.type
  }
  return meta
}

export function homeOf({ source, fromDir }: { source: ThreadMeta; fromDir: string }): EExecutionLocation {
  const session = readMetaSync({ file: sessionMetaFile({ sessionDir: fromDir }), schema: sessionMetaSchema })
  return executionLocationOf(session?.home) ?? executionLocationOf(source.executionLocation) ?? EExecutionLocation.Host
}

export async function sessionDirFor({ context, threadId }: { context: ThreadStoreContext; threadId: ThreadId }): Promise<string> {
  const resolved = await context.registry.sessionDirOf({ threadId })
  if (resolved !== undefined) return resolved
  return sessionDirectory({ home: context.home, sessionId: threadId })
}

export async function sessionDirForNew({
  context,
  id,
  agent,
}: {
  context: ThreadStoreContext
  id: ThreadId
  agent: SupervisedAgent | undefined
}): Promise<string> {
  if (agent === undefined) return sessionDirectory({ home: context.home, sessionId: id })
  return sessionDirFor({ context, threadId: agent.spawnedBy })
}
