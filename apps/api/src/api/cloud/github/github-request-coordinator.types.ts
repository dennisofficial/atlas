import { z } from 'zod'

export const ACCESS_PROOF_TTL_MS = 3_600_000
export const GITHUB_HTTP_BUDGET_PER_MINUTE = 60
export const GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE = 12
export const GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE = 48
export enum EGithubHttpCategory {
  Authorization = 'authorization',
  Refresh = 'refresh',
}

export type RefreshAttempt = { nextAttemptAt: number; failures: number }
export type GithubRequestIdentity = {
  credentialFingerprint: string
  resource: string
  category?: EGithubHttpCategory | undefined
  source?: string | undefined
}

export const repoAccessProofSchema = z.object({
  version: z.number().int().positive(),
  checkedAt: z.number(),
  authorizedUntil: z.number(),
  deniedUntil: z.number(),
  message: z.string().optional(),
})
export type RepoAccessProof = z.infer<typeof repoAccessProofSchema>

export interface CoordinatorAdapter {
  readAuthorization(key: string): Promise<RepoAccessProof | undefined>
  beginAuthorization(key: string): Promise<number>
  writeAuthorization(args: { key: string; state: RepoAccessProof }): Promise<RepoAccessProof>
  takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean>
  httpCooldownUntil(identity: GithubRequestIdentity): Promise<number>
  blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void>
  attempt(key: string): Promise<RefreshAttempt>
  recordAttempt(args: { key: string; failed: boolean }): Promise<void>
}
