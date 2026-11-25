import { ESessionConnection } from '@dltech/atlas-client/stream'
import { agentLabelOf, agentOf } from '@dltech/atlas-client/transcript'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { agentLinksOf, type AgentLinks } from './agent-links'
import { viewOf, type ThreadView } from './rows'
import { useSession } from './use-session'

const TICK_MS = 1_000

export type AgentScreen = ThreadView & {
  now: number
  title: string
  agentLinks: AgentLinks
  loaded: boolean
  failedToLoad: boolean
  loadOlder: () => Promise<number>
}

export function useAgentScreen(args: {
  sessionId: string
  agentId: string
  parentThreadId?: string | undefined
}): AgentScreen {
  const { api } = useAuth()
  const { sessionId, agentId, parentThreadId } = args
  const child = useSession({ sessionId, threadId: agentId, api })
  const parent = useSession({ sessionId, threadId: parentThreadId, api })
  const [now, setNow] = useState(() => Date.now())

  const agent = useMemo(
    () => agentOf({ events: parent.snapshot.foldable, agentId }),
    [parent.snapshot.foldable, agentId],
  )
  const working = agent?.running ?? false
  const view = useMemo(() => viewOf({ snapshot: child.snapshot, now }), [child.snapshot, now])
  const agentLinks = useMemo(
    () => agentLinksOf({ events: child.snapshot.events }),
    [child.snapshot.events],
  )

  useEffect(() => {
    if (!working) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [working])

  const loaded =
    child.snapshot.events.length > 0 || child.snapshot.connection === ESessionConnection.Live

  return {
    ...view,
    working,
    now,
    title: agentLabelOf(agent),
    agentLinks,
    loaded,
    failedToLoad: child.snapshot.error !== undefined && child.snapshot.events.length === 0,
    loadOlder: child.loadOlder,
  }
}
