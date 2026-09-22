import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

import { EDefinitionOrigin, MEMORY_DIRECTORY_NAME, skillRootPlan } from '@dltech/atlas-core'
import {
  atlasDirectory,
  buildContextArchive,
  MAX_CONTEXT_ARCHIVE_BYTES,
  memoryDirectoriesFor,
  resolveSkillRoots,
  type ArchiveFileSource,
  statMemoryDirectory,
} from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'

const SKILLS_DIRECTORY_NAME = 'skills'
const LOCAL_INSTRUCTION_SUFFIX = '.local.md'
const CONTEXT_OVERFLOW_NOTICE_KEY = 'context-archive-overflow'

export type CaptureContext = () => Promise<Buffer | undefined>

const mebibytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MiB`

const walk = async (directory: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
  } catch {
    return []
  }
}

const addFile = (args: { sources: ArchiveFileSource[]; key: string; path: string }): void => {
  args.sources.push({ key: args.key, path: args.path })
}

const addDirectory = async (args: {
  sources: ArchiveFileSource[]
  directory: string
  keyPrefix: string
}): Promise<void> => {
  for (const path of await walk(args.directory)) {
    args.sources.push({ key: `${args.keyPrefix}/${relative(args.directory, path)}`, path })
  }
}

const addFlatMemoryDirectory = async (args: {
  sources: ArchiveFileSource[]
  directory: string
  keyPrefix: string
}): Promise<void> => {
  for (const file of await statMemoryDirectory(args.directory)) {
    args.sources.push({ key: `${args.keyPrefix}/${file.name}`, path: file.path })
  }
}

const addSkillRoots = async (args: {
  sources: ArchiveFileSource[]
  atlasHome: string
  home: string
}): Promise<void> => {
  const roots = await resolveSkillRoots({
    plan: skillRootPlan({
      atlasHome: args.atlasHome,
      home: args.home,
      cwd: args.home,
      skillsDirectoryName: SKILLS_DIRECTORY_NAME,
    }),
  })

  for (const root of roots) {
    if (root.origin !== EDefinitionOrigin.User) continue
    await addDirectory({
      sources: args.sources,
      directory: root.directory,
      keyPrefix: `${root.flavour}/${SKILLS_DIRECTORY_NAME}`,
    })
  }
}

const addProjectLocals = async (args: { sources: ArchiveFileSource[]; cwd: string }): Promise<void> => {
  let entries
  try {
    entries = await readdir(args.cwd, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(LOCAL_INSTRUCTION_SUFFIX)) continue
    addFile({ sources: args.sources, key: `project/${entry.name}`, path: join(args.cwd, entry.name) })
  }
}

const overflowNotice = (args: { bytes: number; maxBytes: number }): void => {
  notify({
    key: CONTEXT_OVERFLOW_NOTICE_KEY,
    text: `the cloud context archive is ${mebibytes(args.bytes)}, over the ${mebibytes(args.maxBytes)} limit — the cloud session lifts without the extra skills, memory and instructions this machine holds`,
    tone: ENoticeTone.Warn,
    ttlMs: NOTICE_WARN_MS,
  })
}

/**
 * The operator's user-level context — skill roots, global instructions, local MCP config, user
 * memory, and (when `cwd` names the repo being lifted) its project memory and gitignored
 * project-local instruction files — staged and packed into a `.tar.gz`. The serve unpacks it into
 * its own home and workspace, so a cloud thread sees the same context as this machine. Everything
 * committed to the repository rides the git transfer instead and is not duplicated here. Returns
 * undefined when there is nothing to carry, and — past the sanity ceiling — warns rather than
 * silently dropping the lift's context.
 */
export async function captureContextArchive(args: {
  cwd?: string | undefined
  home?: string | undefined
  atlasHome?: string | undefined
  maxArchiveBytes?: number | undefined
} = {}): Promise<Buffer | undefined> {
  const home = args.home ?? homedir()
  const atlasHome = args.atlasHome ?? atlasDirectory()
  const maxBytes = args.maxArchiveBytes ?? MAX_CONTEXT_ARCHIVE_BYTES
  const sources: ArchiveFileSource[] = []

  await addSkillRoots({ sources, atlasHome, home })
  addFile({ sources, key: '.atlas/ATLAS.md', path: join(atlasHome, 'ATLAS.md') })
  addFile({ sources, key: '.atlas/mcp.json', path: join(atlasHome, 'mcp.json') })
  await addFlatMemoryDirectory({
    sources,
    directory: join(atlasHome, MEMORY_DIRECTORY_NAME),
    keyPrefix: `.atlas/${MEMORY_DIRECTORY_NAME}`,
  })

  if (args.cwd !== undefined) {
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: args.cwd }).project
    await addFlatMemoryDirectory({ sources, directory: projectMemory, keyPrefix: 'project-memory' })
    await addProjectLocals({ sources, cwd: args.cwd })
  }

  const archive = await buildContextArchive({ files: sources })
  if (archive === undefined) return undefined
  if (archive.byteLength <= maxBytes) return archive

  overflowNotice({ bytes: archive.byteLength, maxBytes })
  return undefined
}
