import { createHash } from 'node:crypto'

import { isTeammateType, type ThreadId } from '@dltech/atlas-core'
import {
  EAnalyticsLinks,
  EAnalyticsThreadKind,
  EMPTY_ANALYTICS,
  type PodAnalytics,
} from '@dltech/atlas-plugin-sdk'

export const HASHED_LINK_LENGTH = 16

export const hashedLinkOf = ({ id }: { id: string }): string =>
  createHash('sha256').update(id).digest('hex').slice(0, HASHED_LINK_LENGTH)

export const threadKindOf = (args: {
  selfAgentId?: string | undefined
  agents: readonly { agentId: string; agentType: string }[]
}): EAnalyticsThreadKind => {
  if (args.selfAgentId === undefined) return EAnalyticsThreadKind.Main
  const held = args.agents.find((agent) => agent.agentId === args.selfAgentId)
  return held !== undefined && isTeammateType(held.agentType)
    ? EAnalyticsThreadKind.Teammate
    : EAnalyticsThreadKind.SubAgent
}

export const analyticsOf = (args: {
  analytics: PodAnalytics | undefined
  sessionId: string
  threadId: ThreadId
  threadKind?: EAnalyticsThreadKind | undefined
}): PodAnalytics => {
  const analytics = args.analytics ?? EMPTY_ANALYTICS
  const raw = { session_id: args.sessionId, thread_id: args.threadId }
  const hashed = {
    session_hash: hashedLinkOf({ id: args.sessionId }),
    thread_hash: hashedLinkOf({ id: args.threadId }),
    ...(args.threadKind === undefined ? {} : { thread_kind: args.threadKind }),
  }
  return {
    capture: ({ event, properties, links }) =>
      analytics.capture({
        event,
        properties: { ...properties, ...(links === EAnalyticsLinks.Hashed ? hashed : raw) },
      }),
  }
}
