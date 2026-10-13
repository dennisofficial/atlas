import { basename, dirname, join } from 'node:path'

import { MEMORY_DIRECTORY_NAME } from '@dltech/atlas-core'

import { statMemoryDirectory } from '../memory/walk-memory'

import { directoryExists, EUserLayerTree, isSyncableName, type TreeLayout, type WatchTarget } from './layout'

const USER_KEY_PREFIX = 'user/'
const PROJECT_KEY_PREFIX = 'project/'

type MemoryDirectory = { prefix: string; directory: string }

export function memoryTree(args: {
  atlasHome: string
  projectMemoryDirectory?: string | undefined
}): TreeLayout {
  const directories: MemoryDirectory[] = [
    { prefix: USER_KEY_PREFIX, directory: join(args.atlasHome, MEMORY_DIRECTORY_NAME) },
  ]
  if (args.projectMemoryDirectory !== undefined) {
    directories.push({ prefix: PROJECT_KEY_PREFIX, directory: args.projectMemoryDirectory })
  }

  const scan = async (): Promise<ReadonlyMap<string, string>> => {
    const keyed = new Map<string, string>()
    for (const { prefix, directory } of directories) {
      for (const file of await statMemoryDirectory(directory)) {
        if (isSyncableName(file.name)) keyed.set(`${prefix}${file.name}`, file.path)
      }
    }
    return keyed
  }

  const locate: TreeLayout['locate'] = (key) => {
    for (const { prefix, directory } of directories) {
      if (!key.startsWith(prefix)) continue
      const name = key.slice(prefix.length)
      if (name === '' || name.includes('/') || name === '.' || name === '..') return null
      return { path: join(directory, name) }
    }
    return null
  }

  const watchTargets = async (): Promise<readonly WatchTarget[]> => {
    const targets: WatchTarget[] = []
    for (const { directory } of directories) {
      if (await directoryExists(directory)) {
        targets.push({ directory, recursive: false })
        continue
      }
      const parent = dirname(directory)
      if (await directoryExists(parent)) {
        targets.push({ directory: parent, recursive: false, accept: (name) => name === basename(directory) })
      }
    }
    return targets
  }

  return { tree: EUserLayerTree.Memory, scan, locate, watchTargets }
}
