import type { TreeLayout } from './layout'
import { instructionsTree } from './tree-instructions'
import { memoryTree } from './tree-memory'
import { skillsTree } from './tree-skills'

export type UserLayerRootsArgs = {
  atlasHome: string
  home: string
  projectDirectory?: string | undefined
  projectMemoryDirectory?: string | undefined
}

export function userLayerTrees(args: UserLayerRootsArgs): readonly TreeLayout[] {
  return [
    skillsTree({ atlasHome: args.atlasHome, home: args.home }),
    instructionsTree({ atlasHome: args.atlasHome, projectDirectory: args.projectDirectory }),
    memoryTree({ atlasHome: args.atlasHome, projectMemoryDirectory: args.projectMemoryDirectory }),
  ]
}
