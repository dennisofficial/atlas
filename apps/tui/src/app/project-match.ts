import { githubProjectOf, normalizeRepoOrigin } from '@dltech/atlas-core'

import { projectRows, type ProjectRow } from '../ui/project-prompt-model'
import type { ProjectChoice } from '../ui/project-prompt-model'

export type { ProjectChoice } from '../ui/project-prompt-model'

export const githubRepoOfOrigin = (args: { originUrl: string }): string | null =>
  githubProjectOf(normalizeRepoOrigin(args.originUrl))

export const matchProject = (args: {
  projects: readonly ProjectChoice[]
  repo: string
}): ProjectChoice | undefined => {
  const wanted = args.repo.toLowerCase()
  let best: ProjectChoice | undefined
  for (const project of args.projects) {
    if (project.repo?.toLowerCase() !== wanted) continue
    if (best === undefined || project.updatedAt > best.updatedAt) best = project
  }
  return best
}

export const projectRowsOf = (args: {
  projects: readonly ProjectChoice[]
}): readonly ProjectRow[] => projectRows(args.projects)
