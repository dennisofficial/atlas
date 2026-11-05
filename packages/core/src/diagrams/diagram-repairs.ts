import { isDiagramRepaired } from './diagram-body'
import { diagramKey, type DiagramRepairs } from './mermaid-fences'

const NO_REPAIRS: DiagramRepairs = new Map()

export type DiagramRepairsByMessage = ReadonlyMap<string, DiagramRepairs>

export function diagramRepairsByMessage(
  events: readonly { type: string }[],
): DiagramRepairsByMessage {
  const byMessage = new Map<string, Map<string, string>>()
  for (const event of events) {
    if (!isDiagramRepaired(event)) continue
    const repairs = byMessage.get(event.messageId) ?? new Map<string, string>()
    repairs.set(diagramKey(event.original), event.repaired)
    byMessage.set(event.messageId, repairs)
  }
  return byMessage
}

export const repairsForMessage = (args: {
  byMessage: DiagramRepairsByMessage
  messageId: string
}): DiagramRepairs => args.byMessage.get(args.messageId) ?? NO_REPAIRS
