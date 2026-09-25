import { z } from 'zod'

import type { ThreadId } from '@dltech/atlas-core'

import { CloudTransport, cloudRequest } from '../cloud/cloud-transport'

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
  gitIdentity: z.object({ name: z.string(), email: z.string() }).nullable().nullish(),
  gpgKey: z.string().nullable().nullish(),
  contextBundle: z.string().nullish(),
  /** The Mac-side project directory the thread was lifted from, absent on an older control plane. */
  projectDirectory: z.string().nullish(),
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

/** `null` on a 404 \u2014 no archive stored yet, so the caller falls back to the spec's legacy bundle. */
export type FetchContextArchive = () => Promise<Uint8Array | null>

/**
 * The sandbox's own token identifies which sandbox row the archive belongs to, so the route it
 * reads from carries no thread id of its own \u2014 unlike the workspace spec route, which the sandbox
 * shares with every other thread the control plane knows about.
 */
export function contextArchiveFetcher(args: {
  controlPlaneUrl: string
  token: string
  fetchFn: typeof fetch
}): FetchContextArchive {
  const transport = new CloudTransport({
    url: args.controlPlaneUrl,
    token: args.token,
    fetchFn: args.fetchFn,
  })

  return () => transport.rawRequest({ method: 'GET', path: '/v1/sandboxes/context', allowMissing: true })
}
