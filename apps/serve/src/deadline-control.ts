import { sandboxNameFor, VercelDriver } from '@dltech/atlas-harness'
import { isApiProvisioned } from '@dltech/atlas-wire'
import type { ThreadId } from '@dltech/atlas-core'

import { controlPlaneError, createApiClient } from './api-client'
import type { DeadlineControl } from './deadline-renewal-loop'

export function deadlineControlFor(args: {
  threadId: ThreadId
  controlPlaneUrl: string
  env: Record<string, string | undefined>
  token: string
  clientVersion?: string | undefined
  fetchFn?: typeof fetch | undefined
}): DeadlineControl | undefined {
  const sessionId = args.env.ATLAS_SANDBOX_SESSION_ID
  if (!sessionId) return undefined
  if (isApiProvisioned(args.env)) {
    const client = createApiClient({
      controlPlaneUrl: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion ?? 'dev',
      fetchFn: args.fetchFn ?? fetch,
    })
    return {
      renew: ({ until }) =>
        client.sandboxSelf.renewDeadline.mutate({ sessionId, until }).catch((failure: unknown) => {
          throw controlPlaneError(failure)
        }),
      rollover: () =>
        client.sandboxRollover.request.mutate({ sessionId }).catch((failure: unknown) => {
          throw controlPlaneError(failure)
        }),
    }
  }
  const token = args.env.VERCEL_TOKEN
  const teamId = args.env.VERCEL_TEAM_ID
  const projectId = args.env.VERCEL_PROJECT_ID
  if (!token || !teamId || !projectId) return undefined
  const driver = new VercelDriver({
    credentials: { token, teamId, projectId },
    cloudUrl: args.controlPlaneUrl,
  })
  const name = sandboxNameFor({ threadId: args.threadId })
  return { renew: ({ until }) => driver.renewDeadline({ name, sessionId, until }) }
}
