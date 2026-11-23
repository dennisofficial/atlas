import { ESessionConnection, sessionStateLineOf } from '@dltech/atlas-client/stream'
import { randomUUID } from 'expo-crypto'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { dismissPresentedForSession } from '../../push/notification-handler'
import type { ThreadRow } from '../rows'
import { agentLinksOf, type AgentLinks } from './agent-links'
import { stagedQueueRowsOf, stagedRowsOf, v2ViewOf, type V2ThreadView } from './rows'
import { clientIdOfSend, settlementOf, type StagedSend } from './staged-send'
import { useV2Session } from './use-v2-session'
import { useV2SessionCommands, type V2SessionCommands } from './use-v2-session-commands'

const TICK_MS = 1_000

export type V2SessionScreen = V2ThreadView & {
  now: number
  stateLine: string | null
  loaded: boolean
  fromCache: boolean
  catchingUp: boolean
  failedToLoad: boolean
  stale: boolean
  agentLinks: AgentLinks
  stagedRows: ThreadRow[]
  commands: V2SessionCommands
  restored: { token: number; text: string } | undefined
  notice: string | undefined
  loadOlder: () => Promise<number>
  send: (message: { text: string }) => Promise<boolean>
  stop: () => void
  retry: () => void
}

export function useV2SessionScreen(sessionId: string): V2SessionScreen {
  const { api } = useAuth()
  const { snapshot, loadOlder } = useV2Session({ sessionId, api })
  const commands = useV2SessionCommands({ api, sessionId, events: snapshot.events })
  const [now, setNow] = useState(() => Date.now())
  const view = useMemo(() => v2ViewOf({ snapshot, now }), [snapshot, now])
  const [staged, setStaged] = useState<readonly StagedSend[]>([])
  const agentLinks = useMemo(() => agentLinksOf({ events: snapshot.events }), [snapshot.events])
  const [restored, setRestored] = useState<{ token: number; text: string } | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const retryClientId = useRef<string | undefined>(undefined)
  const restoreToken = useRef(0)

  useEffect(() => {
    void dismissPresentedForSession(sessionId).catch(() => undefined)
  }, [sessionId])

  useEffect(() => {
    if (!view.working) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [view.working])

  useEffect(() => {
    if (staged.length === 0) return
    const settlement = settlementOf({ staged, events: snapshot.events })
    if (
      settlement.kept.length === staged.length &&
      settlement.restored.length === 0 &&
      settlement.notices.length === 0
    ) {
      return
    }
    setStaged(settlement.kept)
    if (settlement.restored.length > 0) {
      restoreToken.current += 1
      setRestored({ token: restoreToken.current, text: settlement.restored.join('\n\n') })
    }
    if (settlement.notices.length > 0) setNotice(settlement.notices.join('\n'))
  }, [staged, snapshot.events])

  const stagedRows = useMemo(
    () =>
      staged.length === 0
        ? []
        : [
            ...stagedRowsOf({ snapshot, staged, now }),
            ...stagedQueueRowsOf({ snapshot, staged, now }),
          ],
    [snapshot, staged, now],
  )

  const send = useCallback(
    async (message: { text: string }): Promise<boolean> => {
      const text = message.text.trim()
      if (api === undefined || text.length === 0) return false
      const clientId = clientIdOfSend({
        retry: retryClientId.current,
        mint: () => randomUUID(),
      })
      retryClientId.current = clientId
      try {
        await api.sessions.post.mutate({ sessionId, text, clientId })
      } catch {
        return false
      }
      retryClientId.current = undefined
      setNotice(undefined)
      setStaged((current) => [...current, { clientId, text }])
      return true
    },
    [api, sessionId],
  )

  const stop = useCallback(() => {
    void api?.sessions.stop.mutate({ sessionId }).catch(() => undefined)
  }, [api, sessionId])

  const retry = useCallback(() => {
    void api?.sessions.retry.mutate({ sessionId }).catch(() => undefined)
  }, [api, sessionId])

  const loaded = snapshot.cursor !== undefined || snapshot.status !== undefined
  const head = snapshot.events.at(-1)?.seq

  useEffect(() => {
    if (api === undefined || !loaded || view.working) return
    if (head === undefined || head <= 0) return
    void api.sessions.markRead.mutate({ sessionId, seq: head }).catch(() => undefined)
  }, [api, sessionId, loaded, view.working, head])

  return {
    ...view,
    now,
    stateLine: sessionStateLineOf(snapshot),
    loaded,
    agentLinks,
    fromCache: snapshot.fromCache,
    catchingUp: snapshot.fromCache && snapshot.connection !== ESessionConnection.Live,
    failedToLoad: snapshot.error !== undefined,
    stale: snapshot.skipped > 0,
    stagedRows,
    commands,
    restored,
    notice,
    loadOlder,
    send,
    stop,
    retry,
  }
}
