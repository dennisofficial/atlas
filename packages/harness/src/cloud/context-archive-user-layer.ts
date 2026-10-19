import { resolveProjectMemory } from '../memory/project-memory'
import { memoryDirectoriesFor } from '../memory/read-memory'
import type { EUserLayerTree, TreeLayout } from '../user-layer-sync/layout'
import { userLayerTrees, type UserLayerRootsArgs } from '../user-layer-sync/roots'

const USER_LAYER_ARCHIVE_PREFIX = 'user-layer/'

export type UserLayerArchiveFile = { tree: EUserLayerTree; key: string; path: string }

export async function resolveUserLayerRoots(args: {
  atlasHome: string
  home: string
  projectDirectory?: string | undefined
}): Promise<UserLayerRootsArgs> {
  const projectMemoryDirectory = await resolveProjectMemory({
    atlasHome: args.atlasHome,
    repoRoot: args.projectDirectory ?? args.home,
  })
    .then((resolved) => resolved.directories.project)
    .catch(() => undefined)
  return {
    atlasHome: args.atlasHome,
    home: args.home,
    projectDirectory: args.projectDirectory,
    projectMemoryDirectory,
  }
}

export const userLayerArchiveKey = (args: { tree: EUserLayerTree; key: string }): string =>
  `${USER_LAYER_ARCHIVE_PREFIX}${args.tree}/${args.key}`

export async function scanUserLayer(roots: UserLayerRootsArgs): Promise<readonly UserLayerArchiveFile[]> {
  const files: UserLayerArchiveFile[] = []
  for (const layout of userLayerTrees(roots)) {
    for (const [key, path] of await layout.scan()) files.push({ tree: layout.tree, key, path })
  }
  return files
}

export function sandboxUserLayerTrees(args: {
  atlasHome: string
  projectDirectory?: string | undefined
  identity: string | null
}): readonly TreeLayout[] {
  const projectMemoryDirectory = memoryDirectoriesFor({
    atlasHome: args.atlasHome,
    repoRoot: args.projectDirectory ?? args.atlasHome,
    identity: args.identity,
  }).project
  return userLayerTrees({
    atlasHome: args.atlasHome,
    home: args.atlasHome,
    projectDirectory: args.projectDirectory,
    projectMemoryDirectory,
  })
}

export function userLayerTargetOf(args: { archiveKey: string; trees: readonly TreeLayout[] }): string | null {
  if (!args.archiveKey.startsWith(USER_LAYER_ARCHIVE_PREFIX)) return null
  const rest = args.archiveKey.slice(USER_LAYER_ARCHIVE_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const tree = rest.slice(0, slash)
  const layout = args.trees.find((candidate) => candidate.tree === tree)
  return layout?.locate(rest.slice(slash + 1))?.path ?? null
}
