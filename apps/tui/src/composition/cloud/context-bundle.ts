import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

import { EDefinitionOrigin, MEMORY_DIRECTORY_NAME, skillRootPlan } from '@dltech/atlas-core'
import {
  atlasDirectory,
  MAX_CONTEXT_BUNDLE_BYTES,
  memoryDirectoriesFor,
  resolveSkillRoots,
  walkMemoryDirectory,
} from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'

const SKILLS_DIRECTORY_NAME = 'skills'
const LOCAL_INSTRUCTION_SUFFIX = '.local.md'
const CONTEXT_OVERFLOW_NOTICE_KEY = 'context-bundle-overflow'

const mebibytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MiB`

const walk = async (directory: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
  } catch {
    return []
  }
}

const addFile = async (args: { files: Record<string, string>; key: string; path: string }): Promise<void> => {
  try {
    args.files[args.key] = (await readFile(args.path)).toString('base64')
  } catch {
    return
  }
}

const addDirectory = async (args: {
  files: Record<string, string>
  directory: string
  keyPrefix: string
}): Promise<void> => {
  for (const path of await walk(args.directory)) {
    const key = `${args.keyPrefix}/${relative(args.directory, path)}`
    args.files[key] = (await readFile(path)).toString('base64')
  }
}

const addFlatMemoryDirectory = async (args: {
  files: Record<string, string>
  directory: string
  keyPrefix: string
}): Promise<void> => {
  for (const entry of await walkMemoryDirectory(args.directory)) {
    args.files[`${args.keyPrefix}/${entry.name}`] = entry.content
  }
}

const addSkillRoots = async (args: {
  files: Record<string, string>
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
      files: args.files,
      directory: root.directory,
      keyPrefix: `${root.flavour}/${SKILLS_DIRECTORY_NAME}`,
    })
  }
}

const addProjectLocals = async (args: { files: Record<string, string>; cwd: string }): Promise<void> => {
  let entries
  try {
    entries = await readdir(args.cwd, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(LOCAL_INSTRUCTION_SUFFIX)) continue
    await addFile({ files: args.files, key: `project/${entry.name}`, path: join(args.cwd, entry.name) })
  }
}

const overflowNotice = (bytes: number): void => {
  notify({
    key: CONTEXT_OVERFLOW_NOTICE_KEY,
    text: `the cloud context bundle is ${mebibytes(bytes)}, over the ${mebibytes(MAX_CONTEXT_BUNDLE_BYTES)} limit — the cloud session lifts without the extra skills, memory and instructions this machine holds`,
    tone: ENoticeTone.Warn,
    ttlMs: NOTICE_WARN_MS,
  })
}

/**
 * The operator's user-level context — skill roots, global instructions, local MCP config, user
 * memory, and (when `cwd` names the repo being lifted) its project memory and gitignored
 * project-local instruction files — as a JSON map of relative path to base64 content. The serve
 * unpacks it into its own home and workspace, so a cloud thread sees the same context as this
 * machine. Everything committed to the repository rides the git transfer instead and is not
 * duplicated here. Returns undefined when there is nothing to carry, and — past the wire limit —
 * warns rather than silently dropping the lift's context.
 */
export async function captureContextBundle(args: {
  cwd?: string | undefined
  home?: string | undefined
  atlasHome?: string | undefined
} = {}): Promise<string | undefined> {
  const home = args.home ?? homedir()
  const atlasHome = args.atlasHome ?? atlasDirectory()
  const files: Record<string, string> = {}

  await addSkillRoots({ files, atlasHome, home })
  await addFile({ files, key: '.atlas/ATLAS.md', path: join(atlasHome, 'ATLAS.md') })
  await addFile({ files, key: '.atlas/mcp.json', path: join(atlasHome, 'mcp.json') })
  await addFlatMemoryDirectory({
    files,
    directory: join(atlasHome, MEMORY_DIRECTORY_NAME),
    keyPrefix: `.atlas/${MEMORY_DIRECTORY_NAME}`,
  })

  if (args.cwd !== undefined) {
    const projectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: args.cwd }).project
    await addFlatMemoryDirectory({ files, directory: projectMemory, keyPrefix: 'project-memory' })
    await addProjectLocals({ files, cwd: args.cwd })
  }

  if (Object.keys(files).length === 0) return undefined

  const bundle = JSON.stringify(files)
  const bytes = Buffer.byteLength(bundle, 'utf8')
  if (bytes <= MAX_CONTEXT_BUNDLE_BYTES) return bundle

  overflowNotice(bytes)
  return undefined
}
