import { CloudError, cloudRequest } from '@dltech/atlas-harness'
import { githubCloneUrlOf, projectWorkspaceSchema } from '@dltech/atlas-wire'

import { bootstrapWorkspaceSpecFetcher } from './bootstrap-fetchers'
import type { FetchWorkspaceSpec, WorkspaceSpec } from './workspace-spec'

const UNAUTHORIZED = 401
const RETRY_DELAY_MS = 2_000
const DEFAULT_RETRY_BUDGET_MS = 60_000

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function projectWorkspaceSpecFetcher(args: {
  atlasHome: string
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  sleep?: ((ms: number) => Promise<void>) | undefined
  retryBudgetMs?: number | undefined
  now?: (() => number) | undefined
}): FetchWorkspaceSpec {
  const readBootstrap = bootstrapWorkspaceSpecFetcher({ atlasHome: args.atlasHome })
  const sleep = args.sleep ?? defaultSleep
  const retryBudgetMs = args.retryBudgetMs ?? DEFAULT_RETRY_BUDGET_MS
  const now = args.now ?? Date.now
  const url = args.controlPlaneUrl.replace(/\/+$/, '')

  const request = (projectId: string): Promise<unknown> =>
    cloudRequest({
      url,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
      method: 'GET',
      path: `/v1/projects/${encodeURIComponent(projectId)}/workspace`,
      retry: true,
    })

  const requestPatiently = async (projectId: string): Promise<unknown> => {
    const startedAt = now()
    for (;;) {
      try {
        return await request(projectId)
      } catch (error) {
        const registering = error instanceof CloudError && error.status === UNAUTHORIZED
        if (!registering || now() - startedAt + RETRY_DELAY_MS > retryBudgetMs) throw error
        await sleep(RETRY_DELAY_MS)
      }
    }
  }

  return async (): Promise<WorkspaceSpec> => {
    const bootstrap = await readBootstrap()
    if (bootstrap.projectId === undefined || bootstrap.projectId === null) return bootstrap

    const workspace = projectWorkspaceSchema.parse(await requestPatiently(bootstrap.projectId))
    return {
      remoteUrl: workspace.repo === null ? null : githubCloneUrlOf(workspace.repo),
      githubToken: workspace.githubToken,
      model: bootstrap.model,
      projectId: workspace.projectId,
      baseBranch: workspace.baseBranch,
      additionalRepos: workspace.additionalRepos,
    }
  }
}
