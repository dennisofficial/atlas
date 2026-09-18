import { homedir } from 'node:os'
import { dirname, join, normalize, sep } from 'node:path'

import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'
import type { FetchWorkspaceSpec } from './workspace-spec'

export type SkillsReadiness = { written: number; failed: string | null }

/**
 * The bundle is the operator's user-level skill roots as a JSON map of relative path to base64
 * content, captured at attach. `.atlas/skills` maps onto the serve's atlas home; the other
 * flavours land under the sandbox's home directory, mirroring where the registry looks.
 */
const targetOf = (args: {
  path: string
  atlasHome: string
  home: string
}): string | null => {
  const normalized = normalize(args.path)
  if (normalized.startsWith('..') || normalized.startsWith(sep)) return null

  const atlasPrefix = `.atlas${sep}skills${sep}`
  if (normalized.startsWith(atlasPrefix)) {
    return join(args.atlasHome, 'skills', normalized.slice(atlasPrefix.length))
  }

  for (const flavour of ['.agents', '.claude'] as const) {
    const prefix = `${flavour}${sep}skills${sep}`
    if (normalized.startsWith(prefix)) {
      return join(args.home, flavour, 'skills', normalized.slice(prefix.length))
    }
  }

  return null
}

/**
 * Skills are accessory: a bundle that will not parse or write is logged by the caller and the
 * boot carries on without it, unlike the workspace, whose absence hard-blocks the thread.
 */
export async function materializeSkills(args: {
  fetchSpec: FetchWorkspaceSpec
  atlasHome: string
  files?: WorkspaceFiles | undefined
}): Promise<SkillsReadiness> {
  const files = args.files ?? nodeWorkspaceFiles
  const home = homedir()

  let spec
  try {
    spec = await args.fetchSpec()
  } catch (error) {
    return {
      written: 0,
      failed: `the workspace spec did not answer: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (spec.skillsBundle === null || spec.skillsBundle === undefined) {
    return { written: 0, failed: null }
  }

  let entries: Record<string, string>
  try {
    entries = JSON.parse(spec.skillsBundle) as Record<string, string>
  } catch {
    return { written: 0, failed: 'the skills bundle did not parse' }
  }

  let written = 0
  for (const [path, content] of Object.entries(entries)) {
    const target = targetOf({ path, atlasHome: args.atlasHome, home })
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
