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
  const steer = app.agents
  const stopChildrenOf = steer?.stopChildren
  if (steer === undefined || stopChildrenOf === undefined) return undefined
  return {
    stopChildren: async ({ agentId }) => {
      const target = toThreadId(agentId)

      // The teammate's own running turn first: the pod writes the ending, mirrored like any other
      // event, so the roster rebuild on the next boot reads it as deliberately stopped. An
      // unknown or already-settled agent is left alone rather than refusing the stop of the rest.
      const agents = await stopChildrenOf({ threadId: target, by: EKilledBy.User })
      const stoppedSelf = await steer.stop({
        agentId: target,
        threadId: target,
        by: EKilledBy.User,
      })

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
      return {
        agentId,
        stoppedAgents: agents.length + (stoppedSelf.ok ? 1 : 0),
        killedShells,
      }
    },
  }
}
