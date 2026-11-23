'use client'

import { useMemo } from 'react'

import type { RepairDiagramAction } from '@/features/threads/data/diagram-repair'
import type { ThreadTranscriptView } from '@/features/threads/data/transcript-items'

import { withDiagramRepairs } from './session-diagram-repairs'
import { useSessionDiagramRepairs } from './use-session-diagram-repairs'

export function useDiagramRepairedTranscript(args: {
  sessionId: string
  items: ThreadTranscriptView['items']
}): { items: ThreadTranscriptView['items']; repairDiagram: RepairDiagramAction } {
  const { repairs, repairDiagram } = useSessionDiagramRepairs({ sessionId: args.sessionId })
  const items = useMemo(
    () => withDiagramRepairs({ items: args.items, repairs }),
    [args.items, repairs],
  )
  return { items, repairDiagram }
}
