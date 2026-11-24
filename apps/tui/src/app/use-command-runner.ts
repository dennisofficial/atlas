import { useCallback } from 'react'

import { messageOf, problemOf } from './app-next-support'
import type { SessionApi } from './session-api'

export type SessionCommandRunner = {
  run: (input: { name: string; args: Record<string, unknown> }) => void
  stopAgent: (agentId: string) => void
  say: (sent: { agentId: string; text: string }) => void
  killShell: (shellId: string) => void
  stopService: (serviceId: string) => void
  restartService: (serviceId: string) => void
}

/**
 * Every pane action is one `sessions.command` call, so the screen names the action and this turns it
 * into a request. A refusal is reported as a problem line rather than swallowed.
 */
export function useCommandRunner(args: {
  api: SessionApi
  sessionId: string
}): SessionCommandRunner {
  const run = useCallback(
    (input: { name: string; args: Record<string, unknown> }) => {
      args.api
        .runCommand({ sessionId: args.sessionId, ...input })
        .catch((failure: unknown) => problemOf(messageOf(failure)))
    },
    [args.api, args.sessionId],
  )

  return {
    run,
    stopAgent: useCallback(
      (agentId: string) => run({ name: 'agent', args: { action: 'stop', agentId } }),
      [run],
    ),
    say: useCallback(
      (sent: { agentId: string; text: string }) =>
        run({ name: 'agent', args: { action: 'say', ...sent } }),
      [run],
    ),
    killShell: useCallback(
      (shellId: string) => run({ name: 'shell-kill', args: { shellId } }),
      [run],
    ),
    stopService: useCallback(
      (serviceId: string) => run({ name: 'service', args: { action: 'stop', serviceId } }),
      [run],
    ),
    restartService: useCallback(
      (serviceId: string) => run({ name: 'service', args: { action: 'restart', serviceId } }),
      [run],
    ),
  }
}
