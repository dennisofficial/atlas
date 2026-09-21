import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  atlasDirectory,
  extractContextArchive,
  memoryDirectoriesFor,
  safeRelativeSegment,
  UserContextClient,
} from '@dltech/atlas-harness'

import { clientVersionHeader } from '../../build/info'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'

const MERGE_NOTICE_KEY = 'remote-memory-merge'

const USER_PREFIX = 'user/'
const PROJECT_PREFIX = 'project/'

type MergeCandidate = { key: string; mtime: number; readBytes: () => Promise<Buffer> }

type ParsedProjectKey = { projectDirectory: string; name: string }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const localMtimeOf = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

const withinRoot = (args: { root: string; relative: string }): string | null => {
  const safe = safeRelativeSegment(args.relative)
  if (safe === null) return null
  return join(args.root, safe)
}

/**
 * `project/<encodeURIComponent(projectDirectory)>/<name>` — the first path segment after the
 * prefix is the repo the sandbox recorded the file against; anything after that is the filename.
 * A bare `project/<name>` (no slash left over, from a control plane too old to have named a
 * project directory) carries no repo identity and cannot be matched, so it parses to `null`.
 */
const parseProjectKey = (key: string): ParsedProjectKey | null => {
  const rest = key.slice(PROJECT_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash < 1) return null

  const encoded = rest.slice(0, slash)
  const name = rest.slice(slash + 1)
  if (name === '') return null

  try {
    return { projectDirectory: decodeURIComponent(encoded), name }
  } catch {
    return null
  }
}

const samePath = (a: string, b: string): boolean => resolve(a) === resolve(b)

/**
 * A project entry only ever lands when its recorded `projectDirectory` names this same repo —
 * unrecorded (legacy) and cross-repo entries are skipped rather than written, since applying one
 * blind would plant another repo's memory notes into whichever project the operator happens to
 * have open.
 */
const targetOf = (args: {
  key: string
  atlasHome: string
  cwd: string | undefined
}): string | null => {
  if (args.key.startsWith(USER_PREFIX)) {
    return withinRoot({
      root: join(args.atlasHome, 'memory'),
      relative: args.key.slice(USER_PREFIX.length),
    })
  }

  if (args.key.startsWith(PROJECT_PREFIX)) {
    if (args.cwd === undefined) return null

    const parsed = parseProjectKey(args.key)
    if (parsed === null) return null
    if (!samePath(parsed.projectDirectory, args.cwd)) return null

    const projectMemory = memoryDirectoriesFor({ atlasHome: args.atlasHome, repoRoot: args.cwd }).project
    return withinRoot({ root: projectMemory, relative: parsed.name })
  }

  return null
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

const applyCandidates = async (args: {
  candidates: readonly MergeCandidate[]
  atlasHome: string
  cwd: string | undefined
}): Promise<number> => {
  let replaced = 0
  for (const candidate of args.candidates) {
    const target = targetOf({ key: candidate.key, atlasHome: args.atlasHome, cwd: args.cwd })
    if (target === null) continue

    const localMtime = await localMtimeOf(target)
    if (localMtime !== null && localMtime >= candidate.mtime) continue

    try {
      const bytes = await candidate.readBytes()
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, bytes)
      replaced += 1
    } catch (error) {
      notify({
        key: MERGE_NOTICE_KEY,
        tone: ENoticeTone.Warn,
        text: `the remote memory merge could not write ${candidate.key}: ${messageOf(error)}`,
        ttlMs: NOTICE_WARN_MS,
      })
    }
  }

  return replaced
}

/**
 * Pulls the operator's remote memory down onto this machine before it can be shadowed: a launch
 * that never lifts still wants whatever a cloud turn wrote, and a lift about to run
 * `captureContextArchive` must carry the union rather than whatever was last written locally.
 * Last-writer-wins by the mtime the sandbox recorded when it uploaded, so a file this machine
 * touched more recently than the cloud did is left alone.
 */
export async function mergeRemoteMemory(args: {
  session: { url: string; token: string }
  cwd?: string | undefined
  atlasHome?: string | undefined
  fetchFn?: typeof fetch | undefined
}): Promise<{ replaced: number }> {
  const atlasHome = args.atlasHome ?? atlasDirectory()
  const client = new UserContextClient({
    url: args.session.url,
    token: args.session.token,
    clientVersion: clientVersionHeader(),
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })

  const { list, cleanup } = await candidatesFor({ client })
  const replaced = await applyCandidates({ candidates: list, atlasHome, cwd: args.cwd })
  await cleanup().catch(() => undefined)

  if (replaced > 0) {
    notify({
      key: MERGE_NOTICE_KEY,
      tone: ENoticeTone.Warn,
      text: `the cloud held newer memory than this machine — ${replaced} ${replaced === 1 ? 'file' : 'files'} replaced from the last cloud turn`,
      ttlMs: NOTICE_WARN_MS,
    })
  }

  return { replaced }
}
