import { z } from 'zod'

import { GITHUB_REPO_PATTERN } from './project-wire'

export enum EGithubPollStatus {
  Pending = 'pending',
  SlowDown = 'slow-down',
  Denied = 'denied',
  Expired = 'expired',
  MissingScopes = 'missing-scopes',
  Connected = 'connected',
}

export enum EGithubPrStreamFrame {
  PrState = 'pr-state',
  PrEvent = 'pr-event',
  Heartbeat = 'heartbeat',
}

export const githubDeviceCodesSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUrl: z.string(),
  expiresInMs: z.number(),
  intervalMs: z.number(),
})
export type GithubDeviceCodes = z.infer<typeof githubDeviceCodesSchema>

export const githubPollConnectInputSchema = z.strictObject({ deviceCode: z.string().min(1) })
export type GithubPollConnectInput = z.infer<typeof githubPollConnectInputSchema>

export const githubPollResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(EGithubPollStatus.Pending) }),
  z.object({ status: z.literal(EGithubPollStatus.SlowDown) }),
  z.object({ status: z.literal(EGithubPollStatus.Denied) }),
  z.object({ status: z.literal(EGithubPollStatus.Expired) }),
  z.object({ status: z.literal(EGithubPollStatus.MissingScopes), missing: z.array(z.string()) }),
  z.object({
    status: z.literal(EGithubPollStatus.Connected),
    login: z.string(),
    scopes: z.array(z.string()),
  }),
])
export type GithubPollResult = z.infer<typeof githubPollResultSchema>

export const githubConnectionStateSchema = z.discriminatedUnion('connected', [
  z.object({ connected: z.literal(false) }),
  z.object({
    connected: z.literal(true),
    login: z.string(),
    scopes: z.array(z.string()),
    connectedAt: z.string(),
  }),
])
export type GithubConnectionState = z.infer<typeof githubConnectionStateSchema>

export const githubTokenSchema = z.object({ token: z.string() })
export type GithubToken = z.infer<typeof githubTokenSchema>

export const githubBranchesInputSchema = z
  .object({ owner: z.string(), repo: z.string() })
  .refine(({ owner, repo }) => GITHUB_REPO_PATTERN.test(`${owner}/${repo}`), {
    message: 'owner and repo must name a github repository',
  })
export type GithubBranchesInput = z.infer<typeof githubBranchesInputSchema>

export const githubSubscribeInputSchema = z
  .strictObject({
    repoFullName: z
      .string()
      .min(1)
      .regex(/^[^/\s]+\/[^/\s]+$/, { message: 'repoFullName must be owner/repo' }),
    prNumber: z.number().int().positive().optional(),
    branch: z.string().min(1).optional(),
  })
  .refine(({ prNumber, branch }) => (prNumber === undefined) !== (branch === undefined), {
    message: 'exactly one of prNumber or branch is required',
    path: ['branch'],
  })
export type GithubSubscribeInput = z.infer<typeof githubSubscribeInputSchema>

export const githubPrStateSchema = z.object({
  repoFullName: z.string(),
  prNumber: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  headBranch: z.string(),
  headSha: z.string(),
  checksRunning: z.number().int(),
  checksPassed: z.number().int(),
  checksFailed: z.number().int(),
  mergeable: z.boolean().nullable(),
  updatedAt: z.string(),
})
export type GithubPrState = z.infer<typeof githubPrStateSchema>

export const githubAppInstallRecommendationSchema = z.object({
  installUrl: z.string(),
  repoFullName: z.string(),
})

export const githubSubscriptionSchema = z.object({
  id: z.string(),
  repoFullName: z.string(),
  prNumber: z.number().int().nullable(),
  branch: z.string(),
  pollBacked: z.boolean(),
  expiresAt: z.string(),
  state: githubPrStateSchema.nullable(),
  recommendAppInstall: githubAppInstallRecommendationSchema.optional(),
})
export type GithubSubscription = z.infer<typeof githubSubscriptionSchema>

export const githubSubscriptionIdInputSchema = z.object({ id: z.string().min(1) })
export type GithubSubscriptionIdInput = z.infer<typeof githubSubscriptionIdInputSchema>

export const githubHeartbeatSchema = z.object({ expiresAt: z.string() })
export type GithubHeartbeat = z.infer<typeof githubHeartbeatSchema>

export const githubDismissAppInstallNoticeInputSchema = z.object({
  repoFullName: z.string().min(1),
})
export type GithubDismissAppInstallNoticeInput = z.infer<
  typeof githubDismissAppInstallNoticeInputSchema
>

export const githubPrEventSchema = z.object({
  id: z.string(),
  repoFullName: z.string(),
  prNumber: z.number().int(),
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
})
export type GithubPrEvent = z.infer<typeof githubPrEventSchema>

export const githubPrStreamFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(EGithubPrStreamFrame.PrState), state: githubPrStateSchema }),
  z.object({ type: z.literal(EGithubPrStreamFrame.PrEvent), event: githubPrEventSchema }),
  z.object({ type: z.literal(EGithubPrStreamFrame.Heartbeat) }),
])
export type GithubPrStreamFrame = z.infer<typeof githubPrStreamFrameSchema>

const isAsyncIterable = (value: unknown): value is AsyncIterable<GithubPrStreamFrame> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value

export const githubPrStreamOutputSchema =
  z.custom<AsyncIterable<GithubPrStreamFrame>>(isAsyncIterable)
