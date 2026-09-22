import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'

import { extractContextArchive, type ExtractedArchiveEntry } from '../cloud/context-archive'
import { safeRelativeSegment } from '../files/safe-relative-path'
import { memoryDirectoriesFor } from '../memory/read-memory'

import { fetchArchiveWithRetry, type ArchiveRetry } from './context-archive-retry'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'
import type { FetchContextArchive, FetchWorkspaceSpec } from './workspace-spec'

export type ContextReadiness = {
  written: number
  failed: string | null
  projectDirectory: string | null
}

const SKILL_FLAVOURS = ['.agents', '.claude'] as const

const ATLAS_ATLAS_MD = `.atlas${sep}ATLAS.md`
const ATLAS_MCP_JSON = `.atlas${sep}mcp.json`
const ATLAS_SKILLS_PREFIX = `.atlas${sep}skills${sep}`
const ATLAS_MEMORY_PREFIX = `.atlas${sep}memory${sep}`
const PROJECT_MEMORY_PREFIX = `project-memory${sep}`
const PROJECT_PREFIX = `project${sep}`

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const CONTEXT_STAMP_FILE = 'context.stamp'

type ContextStamp = { projectDirectory: string | null }

const contextStampPath = (atlasHome: string): string => join(atlasHome, CONTEXT_STAMP_FILE)

const parseContextStamp = (text: string): ContextStamp | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const projectDirectory = Reflect.get(parsed, 'projectDirectory')
  if (projectDirectory === null || projectDirectory === undefined) {
    return { projectDirectory: null }
  }
  return typeof projectDirectory === 'string' ? { projectDirectory } : null
}

/**
 * A sandbox snapshot restores the whole filesystem across stop/resume, this stamp included, so its
 * presence is what tells a resumed boot apart from a freshly created one that has never received
 * context yet.
 */
const readContextStamp = async (args: {
  files: WorkspaceFiles
  atlasHome: string
}): Promise<ContextStamp | null> => {
  const path = contextStampPath(args.atlasHome)
  if (!(await args.files.exists(path))) return null
  try {
    return parseContextStamp(await args.files.read(path))
  } catch {
    return null
  }
}

const stampContextWithoutFailingBoot = (args: {
  files: WorkspaceFiles
  atlasHome: string
  projectDirectory: string | null
}): Promise<void> =>
  args.files
    .write({
      path: contextStampPath(args.atlasHome),
      text: JSON.stringify({ projectDirectory: args.projectDirectory }),
    })
    .catch(() => undefined)

/**
 * The bundle is the operator's user-level context — skills, global instructions, local MCP
 * config, user and project memory, and gitignored project-local instruction files. `.atlas/...`
 * maps onto the serve's own atlas home, `project-memory/...` and `project/...` map onto the
 * serve's own workspace, and the other skill flavours land under the sandbox's home directory,
 * mirroring where the registry looks. Shared by both the archive path and the legacy JSON path —
 * only the container the keys travel in changed.
 */
const targetOf = (args: {
  path: string
  atlasHome: string
  home: string
  workspaceRoot: string
  projectMemoryDirectory: string
}): string | null => {
  const normalized = safeRelativeSegment(args.path)
  if (normalized === null) return null

  if (normalized === ATLAS_ATLAS_MD) return join(args.atlasHome, 'ATLAS.md')
  if (normalized === ATLAS_MCP_JSON) return join(args.atlasHome, 'mcp.json')

  if (normalized.startsWith(ATLAS_SKILLS_PREFIX)) {
    return join(args.atlasHome, 'skills', normalized.slice(ATLAS_SKILLS_PREFIX.length))
  }
  if (normalized.startsWith(ATLAS_MEMORY_PREFIX)) {
    return join(args.atlasHome, 'memory', normalized.slice(ATLAS_MEMORY_PREFIX.length))
  }

  for (const flavour of SKILL_FLAVOURS) {
    const prefix = `${flavour}${sep}skills${sep}`
    if (normalized.startsWith(prefix)) {
      return join(args.home, flavour, 'skills', normalized.slice(prefix.length))
    }
  }

  if (normalized.startsWith(PROJECT_MEMORY_PREFIX)) {
    return join(args.projectMemoryDirectory, normalized.slice(PROJECT_MEMORY_PREFIX.length))
  }

  if (normalized.startsWith(PROJECT_PREFIX)) {
    const name = normalized.slice(PROJECT_PREFIX.length)
    if (name.includes(sep)) return null
    return join(args.workspaceRoot, name)
  }

  return null
}

type MaterializeRoots = {
  atlasHome: string
  home: string
  cwd: string
  projectMemoryDirectory: string
  projectDirectory: string | null
  files: WorkspaceFiles
}

const writeEntries = async (args: {
  roots: MaterializeRoots
  entries: readonly { path: string; readBytes: () => Promise<Buffer> }[]
}): Promise<ContextReadiness> => {
  const { roots } = args
  let written = 0
  for (const entry of args.entries) {
    const target = targetOf({
      path: entry.path,
      atlasHome: roots.atlasHome,
      home: roots.home,
      workspaceRoot: roots.cwd,
      projectMemoryDirectory: roots.projectMemoryDirectory,
    })
    if (target === null) continue
    try {
      await roots.files.writeBytes({ path: target, bytes: await entry.readBytes() })
      written += 1
    } catch (error) {
      return {
        written,
        failed: `could not write ${entry.path}: ${messageOf(error)}`,
        projectDirectory: roots.projectDirectory,
      }
    }
  }

  await stampContextWithoutFailingBoot({
    files: roots.files,
    atlasHome: roots.atlasHome,
    projectDirectory: roots.projectDirectory,
  })

  return { written, failed: null, projectDirectory: roots.projectDirectory }
}

const materializeFromArchive = async (args: {
  archive: Uint8Array
  roots: MaterializeRoots
}): Promise<ContextReadiness> => {
  let entries: readonly ExtractedArchiveEntry[]
  let cleanup: () => Promise<void>
  try {
    const extracted = await extractContextArchive({ archive: args.archive })
    entries = extracted.entries
    cleanup = extracted.cleanup
  } catch (error) {
    return {
      written: 0,
      failed: `the context archive did not extract: ${messageOf(error)}`,
      projectDirectory: args.roots.projectDirectory,
    }
  }

  try {
    return await writeEntries({
      roots: args.roots,
      entries: entries.map((entry) => ({ path: entry.key, readBytes: () => readFile(entry.path) })),
    })
  } finally {
    await cleanup().catch(() => undefined)
  }
}

const materializeFromLegacyBundle = async (args: {
  bundle: string
  roots: MaterializeRoots
}): Promise<ContextReadiness> => {
  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(args.bundle) as Record<string, string>
  } catch {
    return { written: 0, failed: 'the context bundle did not parse', projectDirectory: args.roots.projectDirectory }
  }

  return writeEntries({
    roots: args.roots,
    entries: Object.entries(parsed).map(([path, content]) => ({
      path,
      readBytes: () => Promise.resolve(Buffer.from(content, 'base64')),
    })),
  })
}

/**
 * Context is accessory: a bundle that will not fetch, extract or parse is logged by the caller and
 * the boot carries on without it, unlike the workspace, whose absence hard-blocks the thread. The
 * archive is tried first when a fetcher is given; a 404 from it is retried on a bounded schedule
 * (see `fetchArchiveWithRetry`) before falling back to the workspace spec's legacy `contextBundle`
 * JSON, which an older control plane still fills in.
 */
export async function materializeContext(args: {
  fetchSpec: FetchWorkspaceSpec
  fetchArchive?: FetchContextArchive | undefined
  archiveRetry?: ArchiveRetry | undefined
  atlasHome: string
  cwd: string
  files?: WorkspaceFiles | undefined
}): Promise<ContextReadiness> {
  const files = args.files ?? nodeWorkspaceFiles

  const stamp = await readContextStamp({ files, atlasHome: args.atlasHome })
  if (stamp !== null) return { written: 0, failed: null, projectDirectory: stamp.projectDirectory }

  const home = homedir()
  const projectMemoryDirectory = memoryDirectoriesFor({
    atlasHome: args.atlasHome,
    repoRoot: args.cwd,
  }).project

  let spec
  try {
    spec = await args.fetchSpec()
  } catch (error) {
    return {
      written: 0,
      failed: `the workspace spec did not answer: ${messageOf(error)}`,
      projectDirectory: null,
    }
  }
  const projectDirectory = spec.projectDirectory ?? null

  const roots: MaterializeRoots = {
    atlasHome: args.atlasHome,
    home,
    cwd: args.cwd,
    projectMemoryDirectory,
    projectDirectory,
    files,
  }

  if (args.fetchArchive !== undefined) {
    let archive: Uint8Array | null
    try {
      archive = await fetchArchiveWithRetry({ fetchArchive: args.fetchArchive, retry: args.archiveRetry })
    } catch (error) {
      return {
        written: 0,
        failed: `the context archive did not answer: ${messageOf(error)}`,
        projectDirectory,
      }
    }
    if (archive !== null) return materializeFromArchive({ archive, roots })
  }

  if (spec.contextBundle === null || spec.contextBundle === undefined) {
    return { written: 0, failed: null, projectDirectory }
  }

  return materializeFromLegacyBundle({ bundle: spec.contextBundle, roots })
}
