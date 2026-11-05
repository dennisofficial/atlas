'use client'

import { createContext, useContext } from 'react'

import { DiagramError, type DiagramRepairArgs } from '../diagram-error'

export type RepairDiagram = (args: DiagramRepairArgs) => Promise<void>

export const DiagramRepairContext = createContext<RepairDiagram | undefined>(undefined)

export function MermaidErrorView({ chart, error }: { chart: string; error: string }) {
  const onRepair = useContext(DiagramRepairContext)
  return <DiagramError chart={chart} error={error} onRepair={onRepair} />
}
