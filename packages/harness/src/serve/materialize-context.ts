import { homedir } from 'node:os'
import { join, normalize, sep } from 'node:path'

import { memoryDirectoriesFor } from '../memory/read-memory'

import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'
import type { FetchWorkspaceSpec } from './workspace-spec'

export type ContextReadiness = { written: number; failed: string | null }

const SKILL_FLAVOURS = ['.agents', '.claude'] as const

const ATLAS_ATLAS_MD = `.atlas${sep}ATLAS.md`
const ATLAS_MCP_JSON = `.atlas${sep}mcp.json`
const ATLAS_SKILLS_PREFIX = `.atlas${sep}skills${sep}`
const ATLAS_MEMORY_PREFIX = `.atlas${sep}memory${sep}`
const PROJECT_MEMORY_PREFIX = `project-memory${sep}`
const PROJECT_PREFIX = `project${sep}`

/**
 * The bundle is the operator's user-level context — skills, global instructions, local MCP
 * config, user and project memory, and gitignored project-local instruction files — captured at
 * attach as a JSON map of relative path to base64 content. `.atlas/...` maps onto the serve's own
 * atlas home, `project-memory/...` and `project/...` map onto the serve's own workspace, and the
 * other skill flavours land under the sandbox's home directory, mirroring where the registry
 * looks.
 */
const targetOf = (args: {
  path: string
  atlasHome: string
  home: string
  workspaceRoot: string
  projectMemoryDirectory: string
}): string | null => {
  const normalized = normalize(args.path)
  if (normalized.startsWith('..') || normalized.startsWith(sep)) return null

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

/**
 * Context is accessory: a bundle that will not parse or write is logged by the caller and the
 * boot carries on without it, unlike the workspace, whose absence hard-blocks the thread.
 */
export async function materializeContext(args: {
  fetchSpec: FetchWorkspaceSpec
  atlasHome: string
  cwd: string
  files?: WorkspaceFiles | undefined
}): Promise<ContextReadiness> {
  const files = args.files ?? nodeWorkspaceFiles
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
      failed: `the workspace spec did not answer: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (spec.contextBundle === null || spec.contextBundle === undefined) {
    return { written: 0, failed: null }
  }

  let entries: Record<string, string>
  try {
    entries = JSON.parse(spec.contextBundle) as Record<string, string>
  } catch {
    return { written: 0, failed: 'the context bundle did not parse' }
  }

  let written = 0
  for (const [path, content] of Object.entries(entries)) {
    const target = targetOf({ path, atlasHome: args.atlasHome, home, workspaceRoot: args.cwd, projectMemoryDirectory })
    if (target === null) continue
    try {
      await files.write({ path: target, text: Buffer.from(content, 'base64').toString('utf8') })
      written += 1
    } catch (error) {
      return {
        written,
        failed: `could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  return { written, failed: null }
}
