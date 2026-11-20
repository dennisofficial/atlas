import { EFinishReason, type V2Event } from '@dltech/atlas-core'
import type { AppendHook, ControlTx } from '@dltech/atlas-control'
import type { ProductAnalytics, ProductAnalyticsProperties } from '@dltech/atlas-observability'
import { reasonClassOf } from '@dltech/atlas-observability'

const OWNER_CACHE_MAX = 10_000

const TRACKED: ReadonlySet<EventType> = new Set<EventType>([
  'input-posted',
  'assistant-said',
  'run-failed',
  'tool-denied',
  'agent-spawned',
  'agent-ended',
  'pull-request-linked',
])

type EventType = V2Event['type']
type Owner = { userId: string; projectId: string | null }
type Mapped = { event: string; properties: ProductAnalyticsProperties }

const endsTurn = (event: V2Event): boolean =>
  event.type === 'assistant-said' &&
  event.finish !== undefined &&
  event.finish !== EFinishReason.ToolCalls

const mappedOf = (event: V2Event): Mapped | undefined => {
  switch (event.type) {
    case 'input-posted': {
      const attachments = event.message?.attachments ?? event.attachments
      return {
        event: 'message_posted',
        properties: {
          has_attachments: (attachments?.length ?? 0) > 0,
          kind: event.kind,
        },
      }
    }
    case 'assistant-said': {
      if (!endsTurn(event)) return undefined
      const usage = event.usage
      return {
        event: 'turn_completed',
        properties: {
          finish: event.finish,
          ...(usage === undefined
            ? {}
            : {
                model_id: usage.modelId,
                provider_id: usage.providerId,
                input_tokens: usage.inputTokens,
                output_tokens: usage.outputTokens,
                cache_read_tokens: usage.cacheReadTokens ?? 0,
                cache_write_tokens: usage.cacheWriteTokens ?? 0,
              }),
        },
      }
    }
    case 'run-failed':
      return {
        event: 'turn_failed',
        properties: {
          kind: event.failure.kind,
          provider_id: event.failure.providerId,
          model_id: event.failure.modelId,
          status_code: event.failure.statusCode,
        },
      }
    case 'tool-denied':
      return {
        event: 'tool_denied',
        properties: { tool: event.name, reason_class: reasonClassOf(event.reason) },
      }
    case 'agent-spawned':
      return { event: 'agent_spawned', properties: { agent_type: event.agentType } }
    case 'agent-ended':
      return {
        event: 'agent_ended',
        properties: {
          agent_type: event.agentType,
          status: event.status,
          turns: event.turns,
          tool_calls: event.toolCalls,
        },
      }
    case 'pull-request-linked':
      return {
        event: 'pull_request_linked',
        properties: { repo: event.repo, number: event.number },
      }
    default:
      return undefined
  }
}

const captureOf = (args: {
  analytics: ProductAnalytics
  sessionId: string
  owner: Owner
  event: V2Event
}): void => {
  try {
    const mapped = mappedOf(args.event)
    if (mapped === undefined) return
    args.analytics.capture({
      userId: args.owner.userId,
      event: mapped.event,
      properties: {
        session_id: args.sessionId,
        project_id: args.owner.projectId,
        ...mapped.properties,
      },
    })
  } catch {
    // A hook runs inside the append transaction; analytics must never roll one back.
  }
}

/**
 * Turns append-log events into product events. The owner is read once per session inside the
 * append tx and cached, because every event in a session names the same person.
 */
export const analyticsAppendHook = (analytics: ProductAnalytics): AppendHook => {
  const owners = new Map<string, Owner>()

  const ownerOf = async (tx: ControlTx, sessionId: string): Promise<Owner | undefined> => {
    const cached = owners.get(sessionId)
    if (cached !== undefined) return cached
    const session = await tx.readSession({ sessionId })
    if (session === undefined) return undefined
    const owner = { userId: session.userId, projectId: session.projectId }
    if (owners.size >= OWNER_CACHE_MAX) {
      const oldest = owners.keys().next().value
      if (oldest !== undefined) owners.delete(oldest)
    }
    owners.set(sessionId, owner)
    return owner
  }

  return {
    name: 'product-analytics',
    appliesTo: (event) =>
      TRACKED.has(event.type) && (event.type !== 'assistant-said' || endsTurn(event)),
    handle: async ({ tx, sessionId, event }) => {
      try {
        const owner = await ownerOf(tx, sessionId)
        if (owner === undefined) return
        captureOf({ analytics, sessionId, owner, event })
      } catch {
        // Never fault the append path on an analytics read.
      }
    },
  }
}
