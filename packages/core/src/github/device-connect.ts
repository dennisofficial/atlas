import { z } from 'zod'

export enum EGithubPollStatus {
  Pending = 'pending',
  SlowDown = 'slow-down',
  Denied = 'denied',
  Expired = 'expired',
  MissingScopes = 'missing-scopes',
  Connected = 'connected',
}

export const githubDeviceCodesSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUrl: z.string(),
  expiresInMs: z.number(),
  intervalMs: z.number(),
})
export type GithubDeviceCodes = z.infer<typeof githubDeviceCodesSchema>

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
