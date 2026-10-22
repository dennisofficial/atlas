import {
  githubConnectPollOutcomeFrom,
  githubConnectPollResponseSchema,
  githubConnectTicketSchema,
  githubStateResponseSchema,
  githubTokenResponseSchema,
  type GithubConnectPollOutcome,
  type GithubConnectTicket,
  type GithubConnection,
} from './github-connect'

type Request = (args: {
  method: string
  path: string
  body?: unknown
  allowMissing?: boolean
}) => Promise<unknown>

export const beginGithubConnectVia = async (request: Request): Promise<GithubConnectTicket> =>
  githubConnectTicketSchema.parse(
    await request({ method: 'POST', path: '/v1/github/connect/begin' }),
  )

export const pollGithubConnectVia = async (args: {
  request: Request
  deviceCode: string
}): Promise<GithubConnectPollOutcome> => {
  const body = await args.request({
    method: 'POST',
    path: '/v1/github/connect/poll',
    body: { deviceCode: args.deviceCode },
  })
  return githubConnectPollOutcomeFrom(githubConnectPollResponseSchema.parse(body))
}

export const dismissGithubAppInstallNoticeVia = async (args: {
  request: Request
  repoFullName: string
}): Promise<void> => {
  await args.request({
    method: 'POST',
    path: '/v1/github/subscriptions/app-install-notice/dismiss',
    body: { repoFullName: args.repoFullName },
  })
}

export const githubConnectionVia = async (request: Request): Promise<GithubConnection | null> => {
  const parsed = githubStateResponseSchema.parse(
    await request({ method: 'GET', path: '/v1/github' }),
  )
  if (!parsed.connected) return null
  return { login: parsed.login, scopes: parsed.scopes, connectedAt: parsed.connectedAt }
}

export const githubTokenVia = async (request: Request): Promise<string | undefined> => {
  const body = await request({ method: 'GET', path: '/v1/github/token', allowMissing: true })
  if (body === undefined) return undefined
  return githubTokenResponseSchema.parse(body).token
}

export const disconnectGithubVia = async (request: Request): Promise<void> => {
  await request({ method: 'DELETE', path: '/v1/github' })
}
