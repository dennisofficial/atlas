import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  atlasDirectory,
  memoryDirectoriesFor,
  safeRelativeSegment,
  UserContextClient,
} from '@dltech/atlas-harness'

import { clientVersionHeader } from '../../build/info'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'

const MERGE_NOTICE_KEY = 'remote-memory-merge'

const USER_PREFIX = 'user/'
const PROJECT_PREFIX = 'project/'

type RemoteMemoryFile = { content: string; mtime: number }

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

const writeRemoteFile = async (args: { path: string; entry: RemoteMemoryFile }): Promise<void> => {
  await mkdir(join(args.path, '..'), { recursive: true })
  await writeFile(args.path, Buffer.from(args.entry.content, 'base64'))
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

/**
 * Pulls the operator's remote memory down onto this machine before it can be shadowed: a launch
 * that never lifts still wants whatever a cloud turn wrote, and a lift about to run
 * `captureContextBundle` must carry the union rather than whatever was last written locally.
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

  let bundle: string | null
  try {
    bundle = await client.readMemoryBundle()
  } catch {
    return { replaced: 0 }
  }
  if (bundle === null) return { replaced: 0 }

  let entries: Record<string, RemoteMemoryFile>
  try {
    entries = JSON.parse(bundle) as Record<string, RemoteMemoryFile>
  } catch {
    return { replaced: 0 }
  }

  let replaced = 0
  for (const [key, entry] of Object.entries(entries)) {
    const target = targetOf({ key, atlasHome, cwd: args.cwd })
    if (target === null) continue

    const localMtime = await localMtimeOf(target)
    if (localMtime !== null && localMtime >= entry.mtime) continue

    try {
      await writeRemoteFile({ path: target, entry })
      replaced += 1
    } catch (error) {
      notify({
        key: MERGE_NOTICE_KEY,
        tone: ENoticeTone.Warn,
        text: `the remote memory merge could not write ${key}: ${messageOf(error)}`,
        ttlMs: NOTICE_WARN_MS,
      })
    }
  }

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
