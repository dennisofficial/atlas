import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { ENoticeTone, NOTICE_WARN_MS, type NoticePort } from '@dltech/atlas-core'

import { safeRelativeSegment } from '../files/safe-relative-path'
import { memoryDirectoriesFor } from '../memory/read-memory'
import { resolveProjectMemory, type ProjectMemoryResolution } from '../memory/project-memory'
import { atlasDirectory } from '../store/paths'

import { extractContextArchive } from './context-archive'
import { applyOne, type MergeCandidate, type RemoteMemoryConflict } from './merge-memory-file'
import { UserContextClient } from './user-context-client'

const MERGE_NOTICE_KEY = 'remote-memory-merge'

const USER_PREFIX = 'user/'
const PROJECT_PREFIX = 'project/'

export type { RemoteMemoryConflict }

export type RemoteMemoryMerge = {
  replaced: number
  conflicts: readonly RemoteMemoryConflict[]
}

enum EProjectKeyKind {
  Identity,
  Path,
}

type ParsedProjectKey = { kind: EProjectKeyKind; value: string; name: string }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const withinRoot = (args: { root: string; relative: string }): string | null => {
  const safe = safeRelativeSegment(args.relative)
  if (safe === null) return null
  return join(args.root, safe)
}

/**
 * `project/<encoded>/<name>` — the encoded middle segment is the repo the sandbox recorded the
 * file against: its normalized origin identity (`github.com/org/repo`) on any recent serve, its
 * Mac-side checkout path on an older one. A bare `project/<name>` carries no repo identity at
 * all and parses to null rather than being matched against whichever repo happens to be open.
 */
const parseProjectKey = (key: string): ParsedProjectKey | null => {
  const rest = key.slice(PROJECT_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash < 1) return null

  const name = rest.slice(slash + 1)
  if (name === '') return null

  let decoded: string
  try {
    decoded = decodeURIComponent(rest.slice(0, slash))
  } catch {
    return null
  }

  const kind = decoded.startsWith('/') ? EProjectKeyKind.Path : EProjectKeyKind.Identity
  return { kind, value: decoded, name }
}

const samePath = (a: string, b: string): boolean => resolve(a) === resolve(b)

/**
 * A project entry only ever lands when its recorded repo IS this repo: by identity when the
 * sandbox knew one (the same for every checkout, worktree and sandbox), or — for entries an
 * older sandbox keyed by checkout path — when that path is one of this repo's own paths.
 */
const targetOf = (args: {
  key: string
  atlasHome: string
  resolution: ProjectMemoryResolution | null
}): string | null => {
  if (args.key.startsWith(USER_PREFIX)) {
    return withinRoot({
      root: join(args.atlasHome, 'memory'),
      relative: args.key.slice(USER_PREFIX.length),
    })
  }

  if (args.key.startsWith(PROJECT_PREFIX)) {
    if (args.resolution === null) return null

    const parsed = parseProjectKey(args.key)
    if (parsed === null) return null

    const { identity, directories, legacyPaths } = args.resolution
    const matches =
      parsed.kind === EProjectKeyKind.Identity
        ? identity !== null && parsed.value === identity
        : legacyPaths.some((path) => samePath(parsed.value, path))
    if (!matches) return null

    return withinRoot({ root: directories.project, relative: parsed.name })
  }

  return null
}

const applyCandidates = async (args: {
  candidates: readonly MergeCandidate[]
  atlasHome: string
  resolution: ProjectMemoryResolution | null
  notice: NoticePort
}): Promise<RemoteMemoryMerge> => {
  let replaced = 0
  const conflicts: RemoteMemoryConflict[] = []
  for (const candidate of args.candidates) {
    const target = targetOf({ key: candidate.key, atlasHome: args.atlasHome, resolution: args.resolution })
    if (target === null) continue

    try {
      const applied = await applyOne({ candidate, target })
      if (applied.replaced) replaced += 1
      if (applied.conflict !== null) conflicts.push(applied.conflict)
    } catch (error) {
      args.notice.notify({
        key: MERGE_NOTICE_KEY,
        tone: ENoticeTone.Warn,
        text: `the remote memory merge could not write ${candidate.key}: ${messageOf(error)}`,
        ttlMs: NOTICE_WARN_MS,
      })
    }
  }

  return { replaced, conflicts }
}

type RemoteMemoryFile = { content: string; mtime: number }

const legacyCandidates = async (
  client: Pick<UserContextClient, 'readMemoryBundle'>,
): Promise<readonly MergeCandidate[]> => {
  let bundle: string | null
  try {
    bundle = await client.readMemoryBundle()
  } catch {
    return []
  }
  if (bundle === null) return []

  let entries: Record<string, RemoteMemoryFile>
  try {
    entries = JSON.parse(bundle) as Record<string, RemoteMemoryFile>
  } catch {
    return []
  }

  return Object.entries(entries).map(([key, entry]) => ({
    key,
    mtime: entry.mtime,
    readBytes: async () => Buffer.from(entry.content, 'base64'),
  }))
}

const NOTHING: { list: readonly MergeCandidate[]; cleanup: () => Promise<void> } = {
  list: [],
  cleanup: async () => undefined,
}

/**
 * The archive is tried first; a clean 404 (reported as `null`) or a body that will not untar falls
 * back to the legacy JSON bundle at the same URL, which an older control plane still fills in. A
 * thrown transport failure — the network is down, the request was aborted — does not retry against
 * the legacy route, since whatever broke the first request breaks the second one too.
 */
const candidatesFor = async (args: {
  client: Pick<UserContextClient, 'readMemoryArchive' | 'readMemoryBundle'>
}): Promise<{ list: readonly MergeCandidate[]; cleanup: () => Promise<void> }> => {
  let archive: Uint8Array | null
  try {
    archive = await args.client.readMemoryArchive()
  } catch {
    return NOTHING
  }

  if (archive !== null) {
    try {
      const extracted = await extractContextArchive({ archive })
      return {
        list: extracted.entries.map((entry) => ({
          key: entry.key,
          mtime: entry.mtimeMs,
          readBytes: () => readFile(entry.path),
        })),
        cleanup: extracted.cleanup,
      }
    } catch {}
  }

  return { list: await legacyCandidates(args.client), cleanup: async () => undefined }
}

const resolutionFor = async (args: {
  atlasHome: string
  cwd: string
}): Promise<ProjectMemoryResolution> => {
  try {
    return await resolveProjectMemory({ atlasHome: args.atlasHome, repoRoot: args.cwd })
  } catch {
    return {
      directories: memoryDirectoriesFor({ atlasHome: args.atlasHome, repoRoot: args.cwd }),
      identity: null,
      legacyPaths: [args.cwd],
    }
  }
}

/**
 * Pulls the operator's remote memory down onto this machine before it can be shadowed: a launch
 * that never lifts still wants whatever a cloud turn wrote, and a lift about to run
 * `captureContextArchive` must carry the union rather than whatever was last written locally.
 * Last-writer-wins by the mtime the sandbox recorded when it uploaded — and where the local copy
 * is that winner with different content, the cloud's version is returned as a conflict so the
 * caller can keep it rather than drop it. Write failures and the replaced-file summary surface
 * through the notice port rather than a surface's own store.
 */
export async function mergeRemoteMemory(args: {
  session: { url: string; token: string }
  clientVersion: string
  notice: NoticePort
  cwd?: string | undefined
  atlasHome?: string | undefined
  fetchFn?: typeof fetch | undefined
}): Promise<RemoteMemoryMerge> {
  const atlasHome = args.atlasHome ?? atlasDirectory()
  const client = new UserContextClient({
    url: args.session.url,
    token: args.session.token,
    clientVersion: args.clientVersion,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })

  const resolution =
    args.cwd === undefined ? null : await resolutionFor({ atlasHome, cwd: args.cwd })
  const { list, cleanup } = await candidatesFor({ client })
  const merged = await applyCandidates({ candidates: list, atlasHome, resolution, notice: args.notice })
  await cleanup().catch(() => undefined)

  if (merged.replaced > 0) {
    args.notice.notify({
      key: MERGE_NOTICE_KEY,
      tone: ENoticeTone.Warn,
      text: `the cloud held newer memory than this machine — ${merged.replaced} ${merged.replaced === 1 ? 'file' : 'files'} replaced from the last cloud turn`,
      ttlMs: NOTICE_WARN_MS,
    })
  }

  return merged
}
