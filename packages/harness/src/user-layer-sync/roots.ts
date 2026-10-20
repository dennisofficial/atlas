import type { TreeLayout } from './layout'
import { instructionsTree } from './tree-instructions'
import { skillsTree } from './tree-skills'

export type UserLayerRootsArgs = {
  atlasHome: string
  home: string
  projectDirectory?: string | undefined
}

export function userLayerTrees(args: UserLayerRootsArgs): readonly TreeLayout[] {
  return [
    skillsTree({ atlasHome: args.atlasHome, home: args.home }),
    instructionsTree({ atlasHome: args.atlasHome, projectDirectory: args.projectDirectory }),
  ]
}
