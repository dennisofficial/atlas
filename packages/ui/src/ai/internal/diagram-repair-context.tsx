'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { DiagramError, type DiagramRepairArgs } from '../diagram-error'

export type DiagramRepairRequest = DiagramRepairArgs & {
  messageText: string
  messageId?: string
}

export type RepairDiagram = (request: DiagramRepairRequest) => Promise<void>

export type DiagramMessage = { text: string; messageId?: string }

export const DiagramRepairContext = createContext<RepairDiagram | undefined>(undefined)
export const DiagramMessageContext = createContext<DiagramMessage | undefined>(undefined)

export function DiagramRepairProvider({
  repair,
  children,
}: {
  repair: RepairDiagram | undefined
  children: ReactNode
}) {
  return <DiagramRepairContext.Provider value={repair}>{children}</DiagramRepairContext.Provider>
}

export function DiagramMessageScope({
  message,
  children,
}: {
  message: DiagramMessage | undefined
  children: ReactNode
}) {
  return <DiagramMessageContext.Provider value={message}>{children}</DiagramMessageContext.Provider>
}

export function MermaidErrorView({ chart, error }: { chart: string; error: string }) {
  const repair = useContext(DiagramRepairContext)
  const message = useContext(DiagramMessageContext)
  const handleRepair = useMemo(() => {
    if (repair === undefined || message === undefined) return undefined
    return (args: DiagramRepairArgs) =>
      repair({
        ...args,
        messageText: message.text,
        ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
      })
  }, [repair, message])
  return <DiagramError chart={chart} error={error} onRepair={handleRepair} />
}
