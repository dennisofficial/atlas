import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { ESkillRootFlavour } from '@dltech/atlas-core'
import { safeRelativeSegment } from '@dltech/atlas-harness'

import { messageOf } from './context-readiness'
import type { WorkspaceFiles } from './workspace-files'

export const COMPATIBILITY_SKILL_FLAVOURS: readonly ESkillRootFlavour[] = [
  ESkillRootFlavour.Agents,
  ESkillRootFlavour.Claude,
]

export type ContextEntry = { path: string; readBytes: () => Promise<Buffer> }

export type ContextTargets = {
  atlasHome: string
  workspaceRoot: string
  projectMemoryDirectory: string
}

const ATLAS_ATLAS_MD = `.atlas${sep}ATLAS.md`
const ATLAS_MCP_JSON = `.atlas${sep}mcp.json`
const ATLAS_SKILLS_PREFIX = `.atlas${sep}skills${sep}`
const ATLAS_MEMORY_PREFIX = `.atlas${sep}memory${sep}`
const PROJECT_MEMORY_PREFIX = `project-memory${sep}`
const PROJECT_PREFIX = `project${sep}`

export const skillFlavourOf = (path: string): ESkillRootFlavour | null => {
  const normalized = safeRelativeSegment(path)
  if (normalized === null) return null
  return COMPATIBILITY_SKILL_FLAVOURS.find((flavour) => normalized.startsWith(`${flavour}${sep}skills${sep}`)) ?? null
}

export const entryTargetOf = (args: { path: string } & ContextTargets): string | null => {
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

  const flavour = skillFlavourOf(normalized)
  if (flavour !== null) return join(args.atlasHome, normalized)

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

export type WriteOutcome = { written: number; failed: string | null }

export const writeContextEntries = async (args: {
  files: WorkspaceFiles
  entries: readonly ContextEntry[]
  targets: ContextTargets
  overwrite: boolean
}): Promise<WriteOutcome> => {
  let written = 0
  for (const entry of args.entries) {
    const target = entryTargetOf({ path: entry.path, ...args.targets })
    if (target === null) continue
    try {
      if (!args.overwrite && await args.files.exists(target)) continue
      await args.files.writeBytes({ path: target, bytes: await entry.readBytes(), overwrite: args.overwrite })
      written += 1
    } catch (error) {
      return { written, failed: `could not write ${entry.path}: ${messageOf(error)}` }
    }
  }
  return { written, failed: null }
}

export const fileEntry = (args: { key: string; path: string }): ContextEntry => ({
  path: args.key,
  readBytes: () => readFile(args.path),
})
