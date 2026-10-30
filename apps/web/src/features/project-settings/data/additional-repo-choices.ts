import type { GithubRepoSummary } from '@dltech/atlas-wire/web'

import { repoChoices } from '@/features/projects/new-project-repos'

export function additionalRepoChoices({
  repos,
  query,
  taken,
}: {
  repos: readonly GithubRepoSummary[]
  query: string
  taken: readonly string[]
}): string[] {
  const takenNames = new Set(taken.map((name) => name.trim().toLowerCase()))
  takenNames.delete(query.trim().toLowerCase())
  return repoChoices({ repos, query }).filter((name) => !takenNames.has(name.toLowerCase()))
}
