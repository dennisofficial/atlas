import { z } from 'zod'

export const ACCESS_PROOF_DENIAL_TTL_MS = 30_000
export const GITHUB_HTTP_BUDGET_PER_MINUTE = 60
export const GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE = 12
export const GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE = 48
export const GITHUB_REFRESH_RESERVED_FOR_REFRESH = 36
export const GITHUB_HTTP_LOW_WATER_RATIO = 0.05
export enum EGithubHttpCategory {
  Authorization = 'authorization',
  Refresh = 'refresh',
  Lookup = 'lookup',
}

export const githubHttpParentOf = (
  category?: EGithubHttpCategory,
): EGithubHttpCategory | undefined =>
  category === EGithubHttpCategory.Lookup ? EGithubHttpCategory.Refresh : undefined

export const githubHttpBudgetOf = (category?: EGithubHttpCategory): number => {
  if (category === EGithubHttpCategory.Authorization) return GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE
  if (category === EGithubHttpCategory.Refresh || category === EGithubHttpCategory.Lookup)
    return GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE
  return GITHUB_HTTP_BUDGET_PER_MINUTE
}

export const githubHttpCeilingOf = (category?: EGithubHttpCategory): number =>
  category === EGithubHttpCategory.Lookup
    ? GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE - GITHUB_REFRESH_RESERVED_FOR_REFRESH
    : githubHttpBudgetOf(category)

export type GithubRequestIdentity = {
  credentialFingerprint: string
  resource: string
  category?: EGithubHttpCategory | undefined
  source?: string | undefined
  essential?: boolean | undefined
}

export const repoAccessProofSchema = z.object({
  version: z.number().int().positive(),
  checkedAt: z.number(),
  granted: z.boolean(),
  deniedUntil: z.number(),
  message: z.string().optional(),
})
export type RepoAccessProof = z.infer<typeof repoAccessProofSchema>

export interface CoordinatorAdapter {
  readAuthorization(key: string): Promise<RepoAccessProof | undefined>
  beginAuthorization(key: string): Promise<number>
  writeAuthorization(args: { key: string; state: RepoAccessProof }): Promise<RepoAccessProof>
  revokeAuthorization(key: string): Promise<void>
  revokeAuthorizations(prefix: string): Promise<void>
  takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean>
  httpCooldownUntil(identity: GithubRequestIdentity): Promise<number>
  httpReserveUntil(identity: GithubRequestIdentity): Promise<number>
  blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void>
  holdHttpReserve(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void>
}
