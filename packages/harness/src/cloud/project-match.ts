import { normalizeRepoOrigin } from '@dltech/atlas-core'
import { GITHUB_REPO_PATTERN, type Project } from '@dltech/atlas-wire'

const GITHUB_HOST_PREFIX = 'github.com/'

export const githubRepoOfOrigin = (originUrl: string): string | null => {
  const identity = normalizeRepoOrigin(originUrl)
  if (identity === null || !identity.startsWith(GITHUB_HOST_PREFIX)) return null
  const tail = identity.slice(GITHUB_HOST_PREFIX.length)
  return GITHUB_REPO_PATTERN.test(tail) ? tail : null
}

export const matchProject = (args: {
  projects: readonly Project[]
  repo: string
}): Project | undefined => {
  const wanted = args.repo.toLowerCase()
  let best: Project | undefined
  for (const project of args.projects) {
    if (project.repo?.toLowerCase() !== wanted) continue
    if (best === undefined || project.updatedAt > best.updatedAt) best = project
  }
  return best
}
