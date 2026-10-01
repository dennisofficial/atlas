import { sandboxNameFor, VercelDriver } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

export function sandboxPark(args: {
  threadId: ThreadId
  controlPlaneUrl: string
  env: Record<string, string | undefined>
}): (() => Promise<void>) | undefined {
  const token = args.env.VERCEL_TOKEN
  const teamId = args.env.VERCEL_TEAM_ID
  const projectId = args.env.VERCEL_PROJECT_ID
  const sessionId = args.env.ATLAS_SANDBOX_SESSION_ID
  if (!token || !teamId || !projectId || !sessionId) return undefined

  const driver = new VercelDriver({
    credentials: { token, teamId, projectId },
    cloudUrl: args.controlPlaneUrl,
  })
  return () => driver.stop({ name: sandboxNameFor({ threadId: args.threadId }), sessionId })
}
