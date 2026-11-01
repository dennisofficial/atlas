import { z } from 'zod'

export const OBSERVATION_TTL_MS = 120_000
export const OBSERVATION_RENEW_MS = 45_000
export const OBSERVATION_INDEX_BATCH = 128
export const GITHUB_HTTP_BUDGET_PER_MINUTE = 60
export const GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE = 12
export const GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE = 48
export enum EGithubHttpCategory {
  Authorization = 'authorization',
  Refresh = 'refresh',
}

export const observedPrSchema = z.object({
  repoFullName: z.string(),
  prNumber: z.number().int().positive(),
})
export type ObservedPr = z.infer<typeof observedPrSchema>
export const observationLeaseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  expiresAt: z.number(),
  credentialFingerprint: z.string(),
  keys: z.array(observedPrSchema).max(128),
  authorizedUntil: z.record(z.string(), z.number()),
})
export type ObservationLease = z.infer<typeof observationLeaseSchema>
export type ObservationAttempt = { nextAttemptAt: number; failures: number }
export type GithubRequestIdentity = {
  credentialFingerprint: string
  resource: string
  category?: EGithubHttpCategory | undefined
}
export type GithubObservationAcquire = {
  id: string
  userId: string
  observe: readonly { repo: string; number: number }[]
  signal?: AbortSignal | undefined
}

export type ObservationAcquisition = { keys: ObservedPr[]; available: boolean; message?: string }
export const observationAuthorizationSchema = z.object({
  version: z.number().int().positive(),
  checkedAt: z.number(),
  authorizedUntil: z.number(),
  deniedUntil: z.number(),
  message: z.string().optional(),
})
export type ObservationAuthorization = z.infer<typeof observationAuthorizationSchema>

export interface ObservationAdapter {
  readAuthorization(key: string): Promise<ObservationAuthorization | undefined>
  beginAuthorization(key: string): Promise<number>
  writeAuthorization(args: {
    key: string
    state: ObservationAuthorization
  }): Promise<ObservationAuthorization>
  read(id: string): Promise<ObservationLease | undefined>
  write(lease: ObservationLease): Promise<void>
  remove(id: string): Promise<void>
  entries(filter?: { repoFullName: string; prNumber?: number }): Promise<ObservationLease[]>
  takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean>
  httpCooldownUntil(identity: GithubRequestIdentity): Promise<number>
  blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void>
  attempt(key: string): Promise<ObservationAttempt>
  recordAttempt(args: { key: string; failed: boolean }): Promise<void>
}
