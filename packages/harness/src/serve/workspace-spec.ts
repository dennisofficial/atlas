import { z } from 'zod'

import type { ThreadId } from '@dltech/atlas-core'

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
  const url = `${args.controlPlaneUrl.replace(/\/+$/, '')}/v1/sandboxes/${args.threadId}/workspace`

  return async () => {
    const response = await args.fetchFn(url, {
      headers: { authorization: `Bearer ${args.token}` },
    })
    if (!response.ok) {
      throw new Error(`the control plane answered ${response.status} for the workspace spec`)
    }
    return wireWorkspaceSpecSchema.parse(await response.json())
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
  const url = `${args.controlPlaneUrl.replace(/\/+$/, '')}/v1/sandboxes/context`

  return async () => {
    const response = await args.fetchFn(url, {
      headers: { authorization: `Bearer ${args.token}` },
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`the control plane answered ${response.status} for the context archive`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }
}
