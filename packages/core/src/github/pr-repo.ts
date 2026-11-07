export const normalizedPrRepo = (repo: string): string =>
  repo.replace(/^github\.com\//i, '').toLowerCase()
