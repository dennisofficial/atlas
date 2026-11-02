import { EKilledBy, EShellStatus, toThreadId } from '@dltech/atlas-core'

import type { SessionServerControl } from './session-server'
import type { ServeApp } from './serve-app'

/**
 * The bearer-authed control surface of a booted serve. Absent when the app carries no agent
 * registry, matching every other registry-backed slot; the route answers 503 while it is absent.
 */
export function serveControlOf(
  app: Pick<ServeApp, 'agents' | 'processes'>,
): SessionServerControl | undefined {
  const stopChildren = app.agents?.stopChildren
  if (stopChildren === undefined) return undefined
  return {
    stopChildren: async ({ agentId }) => {
      const target = toThreadId(agentId)
      const stoppedAgents = await stopChildren({ threadId: target, by: EKilledBy.User })
      const shells = app.processes?.shells
      const killedShells =
        shells?.list === undefined
          ? 0
          : (
              await Promise.all(
                shells
                  .list({ threadId: target })
                  .filter((shell) => shell.status === EShellStatus.Running)
                  .map((shell) =>
                    shells.kill({ shellId: shell.shellId, threadId: target, by: EKilledBy.User }),
                  ),
              )
            ).length
      return { agentId, stoppedAgents: stoppedAgents.length, killedShells }
    },
  }
}
