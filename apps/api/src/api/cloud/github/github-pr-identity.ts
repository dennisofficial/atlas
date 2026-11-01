export const normalizedRepo = (repo: string): string =>
  repo.replace(/^github\.com\//i, '').toLowerCase()
export const repoPattern = (repo: string): string => normalizedRepo(repo).replace(/[_%\\]/g, '\\$&')
export const prIdentity = (pr: { repoFullName: string; prNumber: number }): string =>
  `${normalizedRepo(pr.repoFullName)}#${pr.prNumber}`
