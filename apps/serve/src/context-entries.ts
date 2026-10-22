import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { safeRelativeSegment, userLayerTargetOf, type TreeLayout } from '@dltech/atlas-harness'

import { messageOf } from './context-readiness'
import type { WorkspaceFiles } from './workspace-files'

export type ContextEntry = { path: string; readBytes: () => Promise<Buffer> }

export type ContextTargets = {
  atlasHome: string
  userLayerTrees: readonly TreeLayout[]
}

const ATLAS_MCP_JSON = `.atlas${sep}mcp.json`

export const entryTargetOf = (args: { path: string } & ContextTargets): string | null => {
  const normalized = safeRelativeSegment(args.path)
  if (normalized === ATLAS_MCP_JSON) return join(args.atlasHome, 'mcp.json')
  return userLayerTargetOf({ archiveKey: args.path, trees: args.userLayerTrees })
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
      if (!args.overwrite && (await args.files.exists(target))) continue
      await args.files.writeBytes({
        path: target,
        bytes: await entry.readBytes(),
        overwrite: args.overwrite,
      })
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
