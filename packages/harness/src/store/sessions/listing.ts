import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
  EExecutionLocation,
  EForkMode,
  executionLocationOf,
  toThreadId,
  type ThreadId,
} from '@dltech/atlas-core'

import { titleMatchesHandle } from '../../composition/thread-slug'
import type { SupervisedAgent, ThreadModel, ThreadSummary } from '../thread-store'
import {
  newThreadMeta,
  readMetaSync,
  threadMetaSchema,
  writeMeta,
  type ThreadMeta,
} from './meta'
import { eventLogFile, sessionsDirectory, threadMetaFile, threadsDirectory } from './paths'
import type { SessionRegistry } from './registry'
import { refreshSessionCaches } from './session-meta'
import { threadPlaces } from './thread-places'

export const THREAD_LISTING_LIMIT = 50

export function toThreadSummary(meta: ThreadMeta): ThreadSummary {
  return {
    id: toThreadId(meta.id),
    head: meta.head,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    workspace: meta.workspace,
    repo: meta.repo,
    ...(meta.title === null ? {} : { title: meta.title }),
    ...(meta.parentThreadId === null || meta.forkSeq === null
      ? {}
      : { parent: { threadId: toThreadId(meta.parentThreadId), forkSeq: meta.forkSeq } }),
    ...forkModeOf(meta.forkMode),
    ...agentOf(meta),
    ...modelOf(meta),
    ...locationOf(meta.executionLocation),
  }
}

function forkModeOf(stored: string | null): { forkMode?: EForkMode } {
  if (stored === EForkMode.Reference) return { forkMode: EForkMode.Reference }
  if (stored === EForkMode.Copy) return { forkMode: EForkMode.Copy }
  return {}
}

function agentOf(meta: ThreadMeta): { agent?: SupervisedAgent } {
  if (meta.spawnerThreadId === null || meta.agentType === null) return {}
  return { agent: { spawnedBy: toThreadId(meta.spawnerThreadId), type: meta.agentType } }
}

function modelOf(meta: ThreadMeta): { model?: ThreadModel } {
  if (meta.modelRef === null || meta.modelEffort === null) return {}
  return { model: { ref: meta.modelRef, effort: meta.modelEffort } }
}

function locationOf(stored: string | null): { executionLocation?: EExecutionLocation } {
  const location = executionLocationOf(stored)
  return location === undefined ? {} : { executionLocation: location }
}

export function tryReadThreadMeta({ file }: { file: string }): ThreadMeta | undefined {
  try {
    return readMetaSync({ file, schema: threadMetaSchema })
  } catch {
    return undefined
  }
}

export async function readThreadMetas({ sessionDir }: { sessionDir: string }): Promise<ThreadMeta[]> {
  const names = await readdir(threadsDirectory({ sessionDir })).catch(() => [] as string[])
  const metas: ThreadMeta[] = []
  for (const name of names) {
    if (!name.endsWith('.meta.json')) continue
    const meta = tryReadThreadMeta({ file: join(threadsDirectory({ sessionDir }), name) })
    if (meta !== undefined) metas.push(meta)
  }
  return metas
}

type RootEntry = { sessionDir: string; root: ThreadMeta; activityAt: string }

async function scanRoots({ home, project }: { home: string; project: string }): Promise<RootEntry[]> {
  const root = sessionsDirectory({ home })
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  const entries: RootEntry[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const sessionDir = join(root, dir.name)
    const meta = tryReadThreadMeta({ file: threadMetaFile({ sessionDir, threadId: toThreadId(dir.name) }) })
    if (meta === undefined || meta.spawnerThreadId !== null) continue
    if (meta.repo !== project && meta.workspace !== project) continue
    const metas = await readThreadMetas({ sessionDir })
    const activityAt = metas.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), meta.updatedAt)
    entries.push({ sessionDir, root: meta, activityAt })
  }
  return entries
}

const byActivityDesc = (a: RootEntry, b: RootEntry): number => b.activityAt.localeCompare(a.activityAt)

export async function listRoots({
  home,
  registry,
  project,
  limit = THREAD_LISTING_LIMIT,
}: {
  home: string
  registry: SessionRegistry
  project: string
  limit?: number | undefined
}): Promise<ThreadSummary[]> {
  const entries = (await scanRoots({ home, project })).sort(byActivityDesc).slice(0, limit)
  const summaries: ThreadSummary[] = []
  for (const entry of entries) {
    const places = await threadPlaces({
      home,
      registry,
      sessionDir: entry.sessionDir,
      threadId: toThreadId(entry.root.id),
    })
    await refreshSessionCaches({ registry, sessionDir: entry.sessionDir, root: entry.root, activityAt: entry.activityAt, places })
    summaries.push({
      ...toThreadSummary(entry.root),
      updatedAt: entry.activityAt,
      ...(places.worktree === null ? {} : { worktree: places.worktree }),
      ...(places.pullRequests.length === 0 ? {} : { pullRequests: places.pullRequests }),
    })
  }
  return summaries
}

export async function mostRecentRoot({
  home,
  project,
}: {
  home: string
  project: string
}): Promise<ThreadSummary | undefined> {
  const [first] = (await scanRoots({ home, project })).sort(byActivityDesc)
  return first === undefined ? undefined : toThreadSummary(first.root)
}

export async function findNamedRoot({
  home,
  project,
  handle,
}: {
  home: string
  project: string
  handle: string
}): Promise<ThreadSummary | undefined> {
  const entries = await scanRoots({ home, project })
  const found = entries.find(
    (entry) => entry.root.title !== null && titleMatchesHandle({ title: entry.root.title, handle }),
  )
  return found === undefined ? undefined : toThreadSummary(found.root)
}

export async function touchThreadMeta({
  registry,
  sessionDir,
  threadId,
  at,
}: {
  registry: SessionRegistry
  sessionDir: string
  threadId: ThreadId
  at: string
}): Promise<void> {
  const file = threadMetaFile({ sessionDir, threadId })
  const meta = tryReadThreadMeta({ file }) ?? newThreadMeta({ id: threadId, at })
  const log = await registry.readThreadLog({ sessionDir, threadId })
  await writeMeta({ file, meta: { ...meta, head: log.head, updatedAt: at } })
}

export async function dropRewoundChildren({
  home,
  registry,
  agentIds,
}: {
  home: string
  registry: SessionRegistry
  agentIds: readonly ThreadId[]
}): Promise<void> {
  if (agentIds.length === 0) return
  const root = sessionsDirectory({ home })
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  const located: { sessionDir: string; meta: ThreadMeta }[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const sessionDir = join(root, dir.name)
    for (const meta of await readThreadMetas({ sessionDir })) located.push({ sessionDir, meta })
  }
  for (const agentId of agentIds) {
    const referenced = located.some(({ meta }) => meta.spawnerThreadId === agentId || meta.parentThreadId === agentId)
    const found = located.find(({ meta }) => meta.id === agentId)
    if (found === undefined) continue
    if (referenced) {
      await writeMeta({
        file: threadMetaFile({ sessionDir: found.sessionDir, threadId: agentId }),
        meta: { ...found.meta, spawnerThreadId: null, agentType: null },
      })
      continue
    }
    await rm(threadMetaFile({ sessionDir: found.sessionDir, threadId: agentId }), { force: true })
    await rm(eventLogFile({ sessionDir: found.sessionDir, threadId: agentId }), { force: true })
    const cached = registry.handleFor({ sessionDir: found.sessionDir }).threads.get(agentId)
    if (cached !== undefined) {
      cached.events.length = 0
      cached.unreadable.length = 0
      cached.head = 0
      cached.byContext.clear()
    }
  }
}
