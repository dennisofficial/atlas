'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import { agentHrefOf, agentParamOf, parentAgentParamOf } from './agent-search'

export type SessionAgentSelection = {
  agentId: string | undefined
  parentAgentId: string | undefined
  openAgent: (agentId: string, parentAgentId?: string) => void
  clearAgent: () => void
}

export function useSessionAgent({ openPane }: { openPane: () => void }): SessionAgentSelection {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const agentId = agentParamOf(search)
  const parentAgentId = parentAgentParamOf(search)

  const openAgent = useCallback(
    (next: string, parent?: string) => {
      router.push(agentHrefOf({ pathname, search, agentId: next, parentAgentId: parent }))
      openPane()
    },
    [router, pathname, search, openPane],
  )
  const clearAgent = useCallback(() => {
    router.replace(agentHrefOf({ pathname, search, agentId: parentAgentId }))
  }, [router, pathname, search, parentAgentId])

  return { agentId, parentAgentId, openAgent, clearAgent }
}
