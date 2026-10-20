import { z } from 'zod'

import { CloudTransport } from '@dltech/atlas-harness'
import { projectRepoSchema } from '@dltech/atlas-wire'

export const wireWorkspaceSpecSchema = z.object({
  remoteUrl: z.string().nullable(),
  githubToken: z.string().nullable(),
  /** The model the thread is on; null when none was picked, absent on an older control plane. */
  model: z.string().nullable().nullish(),
  projectId: z.string().nullish(),
  baseBranch: z.string().nullish(),
  additionalRepos: z.array(projectRepoSchema).nullish(),
})

export type WorkspaceSpec = z.infer<typeof wireWorkspaceSpecSchema>

export type FetchWorkspaceSpec = () => Promise<WorkspaceSpec>

/** `null` on a 404 — no archive stored yet, so the caller falls back to the spec's legacy bundle. */
export type FetchContextArchive = () => Promise<Uint8Array | null>

/**
 * The sandbox's own token identifies which sandbox row the archive belongs to, so the route it
 * reads from carries no thread id of its own — unlike the workspace spec route, which the sandbox
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
