import type { ApiClient } from '@dltech/atlas-api-router'

import { cloudCall } from './api-trpc-client'
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

export const beginGithubConnectVia = async (api: ApiClient): Promise<GithubConnectTicket> =>
  githubConnectTicketSchema.parse(await cloudCall(api.github.beginConnect.mutate()))

export const pollGithubConnectVia = async (args: {
  api: ApiClient
  deviceCode: string
}): Promise<GithubConnectPollOutcome> => {
  const body = await cloudCall(args.api.github.pollConnect.mutate({ deviceCode: args.deviceCode }))
  return githubConnectPollOutcomeFrom(githubConnectPollResponseSchema.parse(body))
}

export const dismissGithubAppInstallNoticeVia = async (args: {
  api: ApiClient
  repoFullName: string
}): Promise<void> => {
  await cloudCall(
    args.api.githubSubscriptions.dismissAppInstallNotice.mutate({
      repoFullName: args.repoFullName,
    }),
  )
}

export const githubConnectionVia = async (api: ApiClient): Promise<GithubConnection | null> => {
  const parsed = githubStateResponseSchema.parse(await cloudCall(api.github.get.query()))
  if (!parsed.connected) return null
  return { login: parsed.login, scopes: parsed.scopes, connectedAt: parsed.connectedAt }
}

export const githubTokenVia = async (api: ApiClient): Promise<string | undefined> => {
  const body = await cloudCall(api.github.token.query(), { allowMissing: true })
  if (body === undefined) return undefined
  return githubTokenResponseSchema.parse(body).token
}

export const disconnectGithubVia = async (api: ApiClient): Promise<void> => {
  await cloudCall(api.github.disconnect.mutate())
}
