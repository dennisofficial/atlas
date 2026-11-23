import {
  applyDiagramRepairs,
  diagramKey,
  EDiagramRepair,
  type DiagramRepairOutcome,
} from '@dltech/atlas-core'

import {
  ETranscriptKind,
  type ThreadTranscriptView,
} from '@/features/threads/data/transcript-items'

export type DiagramRepairEntry = {
  source: string
  outcome: DiagramRepairOutcome
  valid: boolean
}

export function acceptedRepairsOf(entries: readonly DiagramRepairEntry[]): Map<string, string> {
  const repairs = new Map<string, string>()
  for (const entry of entries) {
    if (entry.outcome.kind !== EDiagramRepair.Repaired || !entry.valid) continue
    repairs.set(diagramKey(entry.source), entry.outcome.repaired)
  }
  return repairs
}

export function withDiagramRepairs(args: {
  items: ThreadTranscriptView['items']
  repairs: ReadonlyMap<string, string>
}): ThreadTranscriptView['items'] {
  if (args.repairs.size === 0) return args.items
  const repaired = (text: string) => applyDiagramRepairs({ text, repairs: args.repairs })
  return args.items.map((item) => {
    switch (item.kind) {
      case ETranscriptKind.Agent:
        return item.streaming ? item : { ...item, text: repaired(item.text) }
      case ETranscriptKind.Spawn:
        return item.result === undefined ? item : { ...item, result: repaired(item.result) }
      case ETranscriptKind.Report:
        return item.report === undefined ? item : { ...item, report: repaired(item.report) }
      default:
        return item
    }
  })
}
