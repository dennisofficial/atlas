import { z } from 'zod'

export enum EGithubConnectPoll {
  Pending = 'pending',
  SlowDown = 'slow-down',
  Denied = 'denied',
  Expired = 'expired',
  Connected = 'connected',
}

export const githubConnectTicketSchema = z.strictObject({
  deviceCode: z.string().min(1),
  userCode: z.string().min(1),
  verificationUrl: z.string().min(1),
  expiresInMs: z.number().int().positive(),
  intervalMs: z.number().int().positive(),
})

export type GithubConnectTicket = z.infer<typeof githubConnectTicketSchema>

export const githubConnectionSchema = z.strictObject({
  login: z.string().min(1),
  scopes: z.array(z.string()),
  connectedAt: z.string().min(1),
})

export type GithubConnection = z.infer<typeof githubConnectionSchema>

export type GithubConnectPollOutcome =
  | { status: EGithubConnectPoll.Pending }
  | { status: EGithubConnectPoll.SlowDown }
  | { status: EGithubConnectPoll.Denied }
  | { status: EGithubConnectPoll.Expired }
  | { status: EGithubConnectPoll.Connected; connection: GithubConnection }

export const githubConnectPollResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal(EGithubConnectPoll.Pending) }),
  z.strictObject({ status: z.literal(EGithubConnectPoll.SlowDown) }),
  z.strictObject({ status: z.literal(EGithubConnectPoll.Denied) }),
  z.strictObject({ status: z.literal(EGithubConnectPoll.Expired) }),
  z.strictObject({
    status: z.literal(EGithubConnectPoll.Connected),
    login: githubConnectionSchema.shape.login,
    scopes: githubConnectionSchema.shape.scopes,
  }),
])

type GithubConnectPollResponse = z.infer<typeof githubConnectPollResponseSchema>

export const githubStateResponseSchema = z.discriminatedUnion('connected', [
  z.strictObject({ connected: z.literal(false) }),
  z.strictObject({ connected: z.literal(true), ...githubConnectionSchema.shape }),
])

export const githubTokenResponseSchema = z.strictObject({ token: z.string().min(1) })

export const githubConnectPollOutcomeFrom = (
  response: GithubConnectPollResponse,
): GithubConnectPollOutcome => {
  if (response.status !== EGithubConnectPoll.Connected) return response

  return {
    status: EGithubConnectPoll.Connected,
    connection: {
      login: response.login,
      scopes: response.scopes,
      connectedAt: new Date().toISOString(),
    },
  }
}
