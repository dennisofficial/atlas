import { EAgentStatus, EReportKind, reachesModel, type Event } from '@dltech/atlas-core'

const answerKey = (event: { agentId: string; prose: string }): string =>
  `${event.agentId}\u0000${event.prose.trim()}`

/**
 * Logs written before 2026-11-12 hold a done report beside the ending that repeats it: one answer
 * as two rows. Surfaces drop the ending, which the report already says.
 */
export function redundantEndingIds(events: readonly Event[]): ReadonlySet<string> {
  const reported = new Set(
    events.flatMap((event) =>
      event.type === 'agent-reported' && event.kind !== EReportKind.Progress && reachesModel(event)
        ? [answerKey(event)]
        : [],
    ),
  )

  return new Set(
    events.flatMap((event) =>
      event.type === 'agent-ended' &&
      event.status !== EAgentStatus.Failed &&
      reported.has(answerKey(event))
        ? [event.id as string]
        : [],
    ),
  )
}
