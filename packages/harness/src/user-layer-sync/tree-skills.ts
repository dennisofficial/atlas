import { dirname, join } from 'node:path'

import { EDefinitionOrigin, ESkillRootFlavour, isValidTreePath, skillRootPlan, type SkillRoot } from '@dltech/atlas-core'

import { resolveSkillRoots } from '../skills/roots'

import { directoryExists, EUserLayerTree, walkFiles, type TreeLayout, type WatchTarget } from './layout'

const SKILLS_DIRECTORY_NAME = 'skills'

export function skillsTree(args: { atlasHome: string; home: string }): TreeLayout {
  const fullPlan = skillRootPlan({
    atlasHome: args.atlasHome,
    home: args.home,
    cwd: args.home,
    skillsDirectoryName: SKILLS_DIRECTORY_NAME,
  })
  const userPlan = fullPlan.filter((root) => root.origin === EDefinitionOrigin.User)

  const rootOf = (flavour: ESkillRootFlavour): SkillRoot | undefined =>
    userPlan.find((root) => root.flavour === flavour)

  const scan = async (): Promise<ReadonlyMap<string, string>> => {
    const keyed = new Map<string, string>()
    const resolved = await resolveSkillRoots({ plan: fullPlan })
    for (const root of resolved) {
      if (root.origin !== EDefinitionOrigin.User) continue
      for (const [relativePath, path] of await walkFiles(root.directory)) {
        keyed.set(`${root.flavour}/${relativePath}`, path)
      }
    }
    return keyed
  }

  const locate: TreeLayout['locate'] = (key) => {
    if (!isValidTreePath(key)) return null
    const flavour = Object.values(ESkillRootFlavour).find((candidate) => key.startsWith(`${candidate}/`))
    if (flavour === undefined) return null
    const root = rootOf(flavour)
    const relativePath = key.slice(flavour.length + 1)
    if (root === undefined || !isValidTreePath(relativePath)) return null
    return { path: join(root.directory, ...relativePath.split('/')) }
  }

  const watchTargets = async (): Promise<readonly WatchTarget[]> => {
    const targets: WatchTarget[] = []
    for (const root of userPlan) {
      if (await directoryExists(root.directory)) {
        targets.push({ directory: root.directory, recursive: true })
        continue
      }
      targets.push({
        directory: dirname(root.directory),
        recursive: false,
        accept: (name) => name === SKILLS_DIRECTORY_NAME,
      })
    }
    return targets
  }

  return { tree: EUserLayerTree.Skills, scan, locate, watchTargets }
}
