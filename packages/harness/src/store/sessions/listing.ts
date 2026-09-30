import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  EExecutionLocation,
  EForkMode,
  executionLocationOf,
  toThreadId,
  type LinkedPullRequest,
  type LogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { titleMatchesHandle } from '../../composition/thread-slug'
import type { SupervisedAgent, ThreadModel, ThreadSummary } from '../thread-store'
import { readMeta, readMetaSync, threadMetaSchema, type ThreadMeta } from './meta'
import { sessionsDirectory, threadMetaFile, threadsDirectory } from './paths'
import { planSegments } from './compose'
import { placesForSegments } from './session-place-reader'
import type { ThreadWorktree } from './thread-places'
import { warnDirectoryUnreadable } from './listing-cleanup'
import { selectedRoots } from './listing-selected'

export { dropRewoundChildren } from './listing-cleanup'

export const THREAD_LISTING_LIMIT = 50
export const LISTING_ENRICHMENT_LIMIT = 50

const SCAN_CONCURRENCY = 32
const ENRICH_CONCURRENCY = 8

export type ListingPlaces = {
  worktree: ThreadWorktree | null
  pullRequests: LinkedPullRequest[]
}

type RootEntry = { sessionDir: string; root: ThreadMeta; activityAt: string }
type ListingRow = { entry: RootEntry; summary: ThreadSummary; places: ListingPlaces }

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

async function mapConcurrent<Item, Result>({
  items,
  limit,
  map,
}: {
  items: readonly Item[]
  limit: number
  map: (item: Item) => Promise<Result>
}): Promise<Result[]> {
  const results: Result[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) return
      results[index] = await map(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export async function readThreadMetas({
  sessionDir,
  logPort,
}: {
  sessionDir: string
  logPort?: LogPort | undefined
}): Promise<ThreadMeta[]> {
  const directory = threadsDirectory({ sessionDir })
  const names = await readdir(directory).catch((error) => {
    warnDirectoryUnreadable({ logPort, path: directory, error })
    return [] as string[]
  })
  const metas = await Promise.all(
    names
      .filter((name) => name.endsWith('.meta.json'))
      .map((name) => readMeta({ file: join(directory, name), schema: threadMetaSchema }).catch(() => undefined)),
  )
  return metas.filter((meta): meta is ThreadMeta => meta !== undefined)
}

function activityAtOf({ metas, root }: { metas: readonly ThreadMeta[]; root: ThreadMeta }): string {
  return metas.reduce((latest, meta) => (meta.updatedAt > latest ? meta.updatedAt : latest), root.updatedAt)
}

function basicOf({ entry }: { entry: RootEntry }): ThreadSummary {
  return { ...toThreadSummary(entry.root), updatedAt: entry.activityAt }
}

function withPlaces({ summary, places }: { summary: ThreadSummary; places: ListingPlaces }): ThreadSummary {
  return {
    ...summary,
    ...(places.worktree === null ? {} : { worktree: places.worktree }),
    ...(places.pullRequests.length === 0 ? {} : { pullRequests: places.pullRequests }),
  }
}

async function scanRoots({
  home,
  project,
  logPort,
}: {
  home: string
  project: string
  logPort?: LogPort | undefined
}): Promise<RootEntry[]> {
  const root = sessionsDirectory({ home })
  const dirs = await readdir(root, { withFileTypes: true }).catch((error) => {
    warnDirectoryUnreadable({ logPort, path: root, error })
    return []
  })
  const candidates = dirs.filter((dir) => dir.isDirectory()).map((dir) => ({
    sessionDir: join(root, dir.name),
    id: toThreadId(dir.name),
  }))
  const roots = await mapConcurrent({
    items: candidates,
    limit: SCAN_CONCURRENCY,
    map: async ({ sessionDir, id }) => {
      const meta = await readMeta({ file: threadMetaFile({ sessionDir, threadId: id }), schema: threadMetaSchema }).catch(
        () => undefined,
      )
      if (meta === undefined || meta.spawnerThreadId !== null) return undefined
      if (meta.repo !== project && meta.workspace !== project) return undefined
      return { sessionDir, root: meta }
    },
  })
  const matched = roots.filter((entry): entry is { sessionDir: string; root: ThreadMeta } => entry !== undefined)
  return mapConcurrent({
    items: matched,
    limit: SCAN_CONCURRENCY,
    map: async ({ sessionDir, root: meta }) => {
      const metas = await readThreadMetas({ sessionDir, logPort })
      return { sessionDir, root: meta, activityAt: activityAtOf({ metas, root: meta }) }
    },
  })
}

const byActivityDesc = (a: RootEntry, b: RootEntry): number => b.activityAt.localeCompare(a.activityAt)

function snapshotOf({ rows }: { rows: readonly ListingRow[] }): ThreadSummary[] {
  return rows.map((row) => withPlaces({ summary: row.summary, places: row.places }))
}

async function enrichRoots({
  home,
  entries,
  enrich,
  onUpdate,
}: {
  home: string
  entries: readonly RootEntry[]
  enrich: ReadonlySet<string> | undefined
  onUpdate: ((threads: readonly ThreadSummary[]) => void) | undefined
}): Promise<ThreadSummary[]> {
  const rows: ListingRow[] = entries.map((entry) => ({
    entry,
    summary: basicOf({ entry }),
    places: { worktree: null, pullRequests: [] },
  }))
  onUpdate?.(snapshotOf({ rows }))

  const targets =
    enrich === undefined
      ? rows.slice(0, LISTING_ENRICHMENT_LIMIT)
      : rows.filter((row) => enrich.has(row.entry.root.id))
  await mapConcurrent({
    items: targets,
    limit: ENRICH_CONCURRENCY,
    map: async (row) => {
      row.places = await placesForSegments({
        segments: planSegments({ home, sessionDir: row.entry.sessionDir, threadId: toThreadId(row.entry.root.id) }),
      })
      onUpdate?.(snapshotOf({ rows }))
    },
  })

  return snapshotOf({ rows })
}

export async function listRoots({
  home,
  project,
  limit = THREAD_LISTING_LIMIT,
  enrich,
  onUpdate,
  logPort,
}: {
  home: string
  project: string
  limit?: number | undefined
  enrich?: readonly ThreadId[] | undefined
  onUpdate?: ((threads: readonly ThreadSummary[]) => void) | undefined
  logPort?: LogPort | undefined
}): Promise<ThreadSummary[]> {
  if (enrich !== undefined && limit === Number.POSITIVE_INFINITY) {
    const entries = (await selectedRoots({ home, project, ids: enrich })).sort(byActivityDesc)
    return enrichRoots({ home, entries, enrich: new Set<string>(enrich), onUpdate })
  }
  const entries = (await scanRoots({ home, project, logPort })).sort(byActivityDesc).slice(0, limit)
  const enrichIds = enrich === undefined ? undefined : new Set<string>(enrich)
  return enrichRoots({ home, entries, enrich: enrichIds, onUpdate })
}

export async function mostRecentRoot({
  home,
  project,
  logPort,
}: {
  home: string
  project: string
  logPort?: LogPort | undefined
}): Promise<ThreadSummary | undefined> {
  const [first] = (await scanRoots({ home, project, logPort })).sort(byActivityDesc)
  return first === undefined ? undefined : toThreadSummary(first.root)
}

export async function findNamedRoot({
  home,
  project,
  handle,
  logPort,
}: {
  home: string
  project: string
  handle: string
  logPort?: LogPort | undefined
}): Promise<ThreadSummary | undefined> {
  const entries = await scanRoots({ home, project, logPort })
  const found = entries.find(
    (entry) => entry.root.title !== null && titleMatchesHandle({ title: entry.root.title, handle }),
  )
  return found === undefined ? undefined : toThreadSummary(found.root)
}

export { touchThreadMeta } from './listing-cleanup'
