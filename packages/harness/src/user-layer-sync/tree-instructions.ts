import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  directoryExists,
  EUserLayerTree,
  flatFiles,
  type TreeLayout,
  type WatchTarget,
} from './layout'

const ATLAS_INSTRUCTIONS_NAME = 'ATLAS.md'
const ATLAS_KEY_PREFIX = '.atlas/'
const PROJECT_KEY_PREFIX = 'project/'
const LOCAL_SUFFIX = '.local.md'
const ATLAS_NAME = /^ATLAS(\.conflict-[^/]*)?\.md$/
const LOCAL_NAME = /^[^/]+\.local(\.conflict-[^/]*)?\.md$/

export function instructionsTree(args: {
  atlasHome: string
  projectDirectory?: string | undefined
}): TreeLayout {
  const { atlasHome, projectDirectory } = args

  const scan = async (): Promise<ReadonlyMap<string, string>> => {
    const keyed = new Map<string, string>()
    const atlasFile = join(atlasHome, ATLAS_INSTRUCTIONS_NAME)
    if ((await stat(atlasFile).catch(() => null))?.isFile() === true) {
      keyed.set(`${ATLAS_KEY_PREFIX}${ATLAS_INSTRUCTIONS_NAME}`, atlasFile)
    }
    if (projectDirectory === undefined) return keyed

    const locals = await flatFiles({
      directory: projectDirectory,
      accept: (name) => name.endsWith(LOCAL_SUFFIX),
    })
    for (const [name, path] of locals) keyed.set(`${PROJECT_KEY_PREFIX}${name}`, path)
    return keyed
  }

  const locate: TreeLayout['locate'] = (key) => {
    if (key.startsWith(ATLAS_KEY_PREFIX)) {
      const name = key.slice(ATLAS_KEY_PREFIX.length)
      return ATLAS_NAME.test(name) ? { path: join(atlasHome, name) } : null
    }
    if (key.startsWith(PROJECT_KEY_PREFIX) && projectDirectory !== undefined) {
      const name = key.slice(PROJECT_KEY_PREFIX.length)
      return LOCAL_NAME.test(name) ? { path: join(projectDirectory, name) } : null
    }
    return null
  }

  const watchTargets = async (): Promise<readonly WatchTarget[]> => {
    const targets: WatchTarget[] = [
      {
        directory: atlasHome,
        recursive: false,
        accept: (name) => name === ATLAS_INSTRUCTIONS_NAME,
      },
    ]
    if (projectDirectory !== undefined && (await directoryExists(projectDirectory))) {
      targets.push({
        directory: projectDirectory,
        recursive: false,
        accept: (name) => name.endsWith(LOCAL_SUFFIX),
      })
    }
    return targets
  }

  return { tree: EUserLayerTree.Instructions, scan, locate, watchTargets }
}
