'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'

import { agentHrefOf, agentParamOf, parentAgentParamOf } from './agent-search'

export type SessionAgentSelection = {
  agentId: string | undefined
  parentAgentId: string | undefined
  openAgent: (agentId: string, parentAgentId?: string) => void
  clearAgent: () => void
}

type HeldAgent = {
  agentId: string | undefined
  parentAgentId: string | undefined
  heldOver: string
}

export function useSessionAgent({
  expandPane,
}: {
  expandPane: (update: () => void) => void
}): SessionAgentSelection {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const searchKey = search.toString()
  const [held, setHeld] = useState<HeldAgent | undefined>(undefined)
  const heldNow = held?.heldOver === searchKey ? held : undefined
  const agentId = heldNow === undefined ? agentParamOf(search) : heldNow.agentId
  const parentAgentId = heldNow === undefined ? parentAgentParamOf(search) : heldNow.parentAgentId

  const openAgent = useCallback(
    (next: string, parent?: string) => {
      expandPane(() => setHeld({ agentId: next, parentAgentId: parent, heldOver: searchKey }))
      router.push(agentHrefOf({ pathname, search, agentId: next, parentAgentId: parent }))
    },
    [router, pathname, search, searchKey, expandPane],
  )
  const clearAgent = useCallback(() => {
    setHeld({ agentId: parentAgentId, parentAgentId: undefined, heldOver: searchKey })
    router.replace(agentHrefOf({ pathname, search, agentId: parentAgentId }))
  }, [router, pathname, search, searchKey, parentAgentId])

  return { agentId, parentAgentId, openAgent, clearAgent }
}
