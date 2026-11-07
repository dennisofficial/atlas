import { normalizedPrRepo } from '@dltech/atlas-core'

export { normalizedPrRepo as normalizedRepo } from '@dltech/atlas-core'
export const repoPattern = (repo: string): string =>
  normalizedPrRepo(repo).replace(/[_%\\]/g, '\\$&')
export const prIdentity = (pr: { repoFullName: string; prNumber: number }): string =>
  `${normalizedPrRepo(pr.repoFullName)}#${pr.prNumber}`
