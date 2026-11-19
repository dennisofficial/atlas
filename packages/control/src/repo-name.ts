const GITHUB_PREFIX = /^github\.com\//i

export const repoFullNameOf = (repo: string): string =>
  repo.replace(GITHUB_PREFIX, '').toLowerCase()
