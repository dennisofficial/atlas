'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { recallAgent, rememberAgent } from '../panel/pane-memory'
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

const rememberedAgentOf = (args: {
  sessionId: string
  search: URLSearchParams
  searchKey: string
}): HeldAgent | undefined => {
  if (agentParamOf(args.search) !== undefined) return undefined
  const remembered = recallAgent(args.sessionId)
  if (remembered === undefined) return undefined
  return {
    agentId: remembered.agentId,
    parentAgentId: remembered.parentAgentId,
    heldOver: args.searchKey,
  }
}

export function useSessionAgent({
  sessionId,
  enterPane,
  leavePane,
}: {
  sessionId: string
  enterPane: (update: () => void) => void
  leavePane: (update: () => void) => void
}): SessionAgentSelection {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const searchKey = search.toString()
  const [held, setHeld] = useState(() => rememberedAgentOf({ sessionId, search, searchKey }))
  const restored = useRef(held)
  const heldNow = held?.heldOver === searchKey ? held : undefined
  const agentId = heldNow === undefined ? agentParamOf(search) : heldNow.agentId
  const parentAgentId = heldNow === undefined ? parentAgentParamOf(search) : heldNow.parentAgentId

  useEffect(() => {
    if (held === undefined || held.heldOver === searchKey) return
    setHeld(undefined)
  }, [held, searchKey])

  useEffect(() => {
    const agent = restored.current
    restored.current = undefined
    if (agent?.agentId === undefined) return
    router.replace(agentHrefOf({ pathname, search, ...agent }))
  }, [router, pathname, search])

  useEffect(() => {
    rememberAgent({
      sessionId,
      agent: agentId === undefined ? undefined : { agentId, parentAgentId },
    })
  }, [sessionId, agentId, parentAgentId])

  const openAgent = useCallback(
    (next: string, parent?: string) => {
      enterPane(() => setHeld({ agentId: next, parentAgentId: parent, heldOver: searchKey }))
      router.push(agentHrefOf({ pathname, search, agentId: next, parentAgentId: parent }))
    },
    [router, pathname, search, searchKey, enterPane],
  )
  const clearAgent = useCallback(() => {
    const showParent = () =>
      setHeld({ agentId: parentAgentId, parentAgentId: undefined, heldOver: searchKey })
    if (parentAgentId === undefined) leavePane(showParent)
    else showParent()
    router.replace(agentHrefOf({ pathname, search, agentId: parentAgentId }))
  }, [router, pathname, search, searchKey, parentAgentId, leavePane])

  return { agentId, parentAgentId, openAgent, clearAgent }
}
