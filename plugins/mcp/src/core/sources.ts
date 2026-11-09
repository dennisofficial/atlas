import type { LoadedMcpEntry, McpRejection, McpSourceRead } from './specs'

export type McpSourceInput = McpSourceRead & { compat?: boolean }

export type MergedMcp = {
  servers: readonly LoadedMcpEntry[]
  shadowed: readonly LoadedMcpEntry[]
  rejections: readonly McpRejection[]
}

// Sources arrive in increasing priority: cloud user, cloud project, repo `.atlas/mcp.json`, repo
// `.mcp.json`. A later source outranks an earlier one of the same name, which is what makes a repo
// file beat a cloud project row. Claude's compat file never beats a native definition of a name.
export const mergeMcpSources = (args: { sources: readonly McpSourceInput[] }): MergedMcp => {
  const nativeNames = new Set(
    args.sources
      .filter((source) => source.compat !== true)
      .flatMap((source) => source.entries.map((entry) => entry.name)),
  )

  const winners = new Map<string, LoadedMcpEntry>()
  const shadowed: LoadedMcpEntry[] = []

  for (const source of args.sources) {
    for (const entry of source.entries) {
      if (source.compat === true && nativeNames.has(entry.name)) {
        shadowed.push(entry)
        continue
      }
      const held = winners.get(entry.name)
      if (held !== undefined) shadowed.push(held)
      winners.set(entry.name, entry)
    }
  }

  const servers = [...winners.values()]
    .filter((entry) => entry.disabled !== true)
    .sort((left, right) => left.name.localeCompare(right.name))

  return { servers, shadowed, rejections: args.sources.flatMap((source) => source.rejections) }
}
