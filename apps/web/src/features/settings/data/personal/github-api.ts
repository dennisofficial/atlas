import { z } from 'zod'

import { cloudJson, EHttpMethod } from '@/lib/cloud-api'

const connectionSchema = z.discriminatedUnion('connected', [
  z.object({ connected: z.literal(false) }),
  z.object({
    connected: z.literal(true),
    login: z.string(),
    scopes: z.array(z.string()),
    connectedAt: z.string(),
  }),
])

export type GithubConnection = z.infer<typeof connectionSchema>

export const GITHUB_ORG_SCOPE = 'read:org'
export const GITHUB_REPO_SCOPE = 'repo'

export function fetchGithub(): Promise<GithubConnection> {
  return cloudJson({ method: EHttpMethod.Get, path: '/v1/github', schema: connectionSchema })
}

export const githubLoginOf = (connection: GithubConnection): string | null =>
  connection.connected ? connection.login : null
