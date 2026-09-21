import { z } from 'zod'

import type { ThreadId } from '@dltech/atlas-core'

import { cloudRequest } from '../cloud/cloud-transport'

/**
 * Fetched rather than injected: a patch carrying every uncommitted change outgrows what a process
 * environment will hold, and the sandbox already holds a token that authenticates the read.
 */
export const wireWorkspaceSpecSchema = z.object({
  remoteUrl: z.string().nullable(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  patch: z.string(),
  githubToken: z.string().nullable(),
  skillsBundle: z.string().nullish(),
})

export type WorkspaceSpec = z.infer<typeof wireWorkspaceSpecSchema>

export type FetchWorkspaceSpec = () => Promise<WorkspaceSpec>

export function workspaceSpecFetcher(args: {
  controlPlaneUrl: string
  threadId: ThreadId
  token: string
  fetchFn: typeof fetch
}): FetchWorkspaceSpec {
  const url = args.controlPlaneUrl.replace(/\/+$/, '')

  return async () => {
    const body = await cloudRequest({
      url,
      token: args.token,
      clientVersion: 'dev',
      fetchFn: args.fetchFn,
      method: 'GET',
      path: `/v1/sandboxes/${args.threadId}/workspace`,
      retry: true,
    })
    return wireWorkspaceSpecSchema.parse(body)
  }
}
