'use client'

import { useCallback, type ReactNode } from 'react'

import { diagramContextOf } from '@dltech/atlas-core'
import {
  DiagramRepairProvider,
  type DiagramRepairRequest,
  type RepairDiagram,
} from '@dltech/atlas-ui/ai/diagram-repair'

import type { RepairDiagramAction } from './diagram-repair'
import { useDiagramRepair } from './use-diagram-repair'

export const NO_MESSAGE_ID = ''

export function repairCallOf(args: {
  repairDiagram: RepairDiagramAction
  request: DiagramRepairRequest
}): Promise<void> {
  const { repairDiagram, request } = args
  const context = diagramContextOf({ text: request.messageText, source: request.chart })
  return repairDiagram({
    messageId: request.messageId ?? NO_MESSAGE_ID,
    chart: request.chart,
    error: request.error,
    ...(context.length === 0 ? {} : { context }),
  })
}

export function SessionDiagramRepairProvider({
  repairDiagram,
  children,
}: {
  repairDiagram: RepairDiagramAction | null
  children: ReactNode
}) {
  const handleRepair = useCallback<RepairDiagram>(
    (request) => {
      if (repairDiagram === null) return Promise.resolve()
      return repairCallOf({ repairDiagram, request })
    },
    [repairDiagram],
  )
  return (
    <DiagramRepairProvider repair={repairDiagram === null ? undefined : handleRepair}>
      {children}
    </DiagramRepairProvider>
  )
}

export function ChannelDiagramRepairProvider({ children }: { children: ReactNode }) {
  const repairDiagram = useDiagramRepair()
  return (
    <SessionDiagramRepairProvider repairDiagram={repairDiagram}>
      {children}
    </SessionDiagramRepairProvider>
  )
}
