import type { LogPort } from '@dltech/atlas-core'

import type { CloudSession, CloudSessionStore } from '../../cloud/cloud-session'
import type { PrEventFrame } from '../../cloud/pr-event-frame'
import type { AppInstallRecommendation } from '../../cloud/pr-subscription-client'
import { SsePullRequestPort } from '../../cloud/sse-pull-requests'
import { FailoverPullRequestPort } from './failover-pull-requests'
import { EGhPollRole, GhPullRequestPort } from './gh-pull-requests'
import type { PullRequestReading } from './pure'

/**
 * A cloud session (serve or signed-in operator) rides the SSE port: the API fans webhook
 * deliveries out to it in real time, so it pushes rather than polls, and a `gh` poller stands
 * behind it for as long as the API is unreachable. A signed-out operator
 * keeps the `gh` poller as degraded mode. The SSE port's `onReading` closes over the service
 * built after it — the deferred indirection is what lets the port outlive its own construction.
 */
export function selectPullRequestPort(args: {
  serve: CloudSession | null
  sessions: CloudSessionStore
  clientVersion: string
  log: LogPort | null
  onReading: (reading: { key: string; reading: PullRequestReading }) => void
  onPrEvent: (frame: PrEventFrame) => void
  onAppInstallRecommended: ((recommendation: AppInstallRecommendation) => void) | undefined
}): FailoverPullRequestPort | GhPullRequestPort {
  const session = args.serve ?? args.sessions.read()
  if (session !== null) {
    const log = args.log === null ? {} : { log: { port: args.log } }
    return new FailoverPullRequestPort({
      primary: new SsePullRequestPort({
        session,
        clientVersion: args.clientVersion,
        onReading: args.onReading,
        onPrEvent: args.onPrEvent,
        ...(args.onAppInstallRecommended === undefined
          ? {}
          : { onAppInstallRecommended: args.onAppInstallRecommended }),
        ...log,
      }),
      fallback: new GhPullRequestPort({
        role: EGhPollRole.FailoverFallback,
        ...(args.log === null ? {} : { log: args.log }),
      }),
      ...log,
    })
  }

  return new GhPullRequestPort({
    role: EGhPollRole.SignedOut,
    ...(args.log === null ? {} : { log: args.log }),
  })
}
