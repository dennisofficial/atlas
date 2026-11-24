import { clientOnlyReason } from '@dltech/atlas-commands'
import {
  canReconnectOf,
  ESessionConnection,
  sessionStateLineOf,
  startFailureOf,
} from '@dltech/atlas-client/stream'
import { quickStopRestoresToApply } from '@dltech/atlas-client/session'
import { turnStartedAtOf } from '@dltech/atlas-client/transcript'
import type { Attachment } from '@dltech/atlas-core'
import { randomUUID } from 'expo-crypto'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { dismissPresentedForSession } from '../../push/notification-handler'
import type { ThreadRow } from '../rows'
import { agentLinksOf, type AgentLinks } from './agent-links'
import type { ContextMeter } from '../composer/context-reading'
import { queuedDockOf, type QueuedDockState } from './queued-dock'
import { stagedRowsOf, v2ViewOf, type V2ThreadView } from './rows'
import { sessionHeaderOf, type SessionHeader } from './session-header'
import { sessionStream } from './session-stream'
import { handledQuickStopsOf, rememberHandledQuickStops } from './handled-quick-stops'
import { clientIdOfSend, settlementOf, type StagedSend } from './staged-send'
import { useV2Session } from './use-v2-session'
import { useSessionSummary } from './use-session-summary'
import { useV2SessionCommands, type V2SessionCommands } from './use-v2-session-commands'
import { useOperatorRequest, type OperatorRequestControl } from './use-operator-request'

const TICK_MS = 1_000

export type V2SessionScreen = V2ThreadView & {
  now: number
  stateLine: string | null
  canReconnect: boolean
  header: SessionHeader
  queued: QueuedDockState
  startFailure: { reason: string | undefined } | undefined
  loaded: boolean
  fromCache: boolean
  catchingUp: boolean
  failedToLoad: boolean
  stale: boolean
  context: ContextMeter | null
  agentLinks: AgentLinks
  stagedRows: ThreadRow[]
  commands: V2SessionCommands
  operator: OperatorRequestControl
  restored: { token: number; text: string; attachments: readonly Attachment[] } | undefined
  notice: string | undefined
  loadOlder: () => Promise<number>
  send: (message: { text: string; attachments: Attachment[] }) => Promise<boolean>
  stop: () => void
  retry: () => Promise<void>
  reconnect: () => void
}

export function useV2SessionScreen(args: {
  sessionId: string
  fallbackTitle: string | undefined
}): V2SessionScreen {
  const { sessionId, fallbackTitle } = args
  const { api } = useAuth()
  const { snapshot, loadOlder } = useV2Session({ sessionId, api })
  const summary = useSessionSummary(sessionId)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const reportHidden = useCallback((name: string) => setNotice(clientOnlyReason(name)), [setNotice])
  const commands = useV2SessionCommands({
    api,
    sessionId,
    events: snapshot.foldable,
    reportHidden,
  })
  const operator = useOperatorRequest({ api, sessionId, events: snapshot.events })
  const [now, setNow] = useState(() => Date.now())
  const view = useMemo(() => v2ViewOf({ snapshot, now }), [snapshot, now])
  const [staged, setStaged] = useState<readonly StagedSend[]>([])
  const agentLinks = useMemo(() => agentLinksOf({ events: snapshot.events }), [snapshot.events])
  const [restored, setRestored] = useState<
    { token: number; text: string; attachments: readonly Attachment[] } | undefined
  >(undefined)
  const retryClientId = useRef<string | undefined>(undefined)
  const restoreToken = useRef(0)
  const sent = useRef<ReadonlySet<string>>(new Set())
  const unread = useMemo(
    () =>
      new Set(
        snapshot.pending.pending.flatMap((input) =>
          input.message?.clientId === undefined ? [] : [input.message.clientId],
        ),
      ),
    [snapshot.pending],
  )

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
    const settlement = settlementOf({ staged, events: snapshot.events, unread })
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
      setRestored({
        token: restoreToken.current,
        text: settlement.restored.map((entry) => entry.text).join('\n\n'),
        attachments: settlement.restored.flatMap((entry) => [...entry.attachments]),
      })
    }
    if (settlement.notices.length > 0) setNotice(settlement.notices.join('\n'))
  }, [staged, snapshot.events, unread])

  useEffect(() => {
    const pending = quickStopRestoresToApply({
      quickStops: snapshot.quickStops,
      clientIds: [...sent.current],
      handled: handledQuickStopsOf(sessionId),
    })
    if (pending.length === 0) return
    rememberHandledQuickStops({
      sessionId,
      rewindEventIds: pending.map((entry) => entry.rewindEventId),
    })
    restoreToken.current += 1
    setRestored({
      token: restoreToken.current,
      text: pending.map((entry) => entry.text).join('\n\n'),
      attachments: pending.flatMap((entry) => [...entry.attachments]),
    })
  }, [snapshot.quickStops, sessionId])

  const stagedRows = useMemo(
    () => (staged.length === 0 ? [] : stagedRowsOf({ snapshot, staged, now })),
    [snapshot, staged, now],
  )
  const queued = useMemo(() => queuedDockOf({ snapshot, staged }), [snapshot, staged])
  const turnStartedAt = useMemo(
    () => turnStartedAtOf({ events: snapshot.foldable, status: snapshot.status }),
    [snapshot.foldable, snapshot.status],
  )
  const header = useMemo(
    () => sessionHeaderOf({ summary, fallbackTitle, status: snapshot.status, turnStartedAt, now }),
    [summary, fallbackTitle, snapshot.status, turnStartedAt, now],
  )

  const send = useCallback(
    async (message: { text: string; attachments: Attachment[] }): Promise<boolean> => {
      const text = message.text.trim()
      const attachments = message.attachments
      if (api === undefined || (text.length === 0 && attachments.length === 0)) return false
      const clientId = clientIdOfSend({
        retry: retryClientId.current,
        mint: () => randomUUID(),
      })
      retryClientId.current = clientId
      try {
        await api.sessions.post.mutate({
          sessionId,
          text,
          clientId,
          sentAt: new Date().toISOString(),
          ...(attachments.length === 0 ? {} : { attachments }),
        })
      } catch {
        return false
      }
      retryClientId.current = undefined
      sent.current = new Set([...sent.current, clientId])
      setNotice(undefined)
      setStaged((current) => [...current, { clientId, text, attachments }])
      return true
    },
    [api, sessionId],
  )

  const stop = useCallback(() => {
    void api?.sessions.stop.mutate({ sessionId }).catch(() => undefined)
  }, [api, sessionId])

  const retry = useCallback(async () => {
    if (api === undefined) return
    try {
      await api.sessions.retry.mutate({ sessionId })
    } catch {
      setNotice('Retry failed. Try again.')
    }
  }, [api, sessionId])

  const reconnect = useCallback(() => {
    if (api !== undefined) sessionStream(api).reconnect()
  }, [api])

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
    canReconnect: canReconnectOf(snapshot),
    header,
    queued,
    startFailure: startFailureOf(snapshot.status),
    loaded,
    agentLinks,
    fromCache: snapshot.fromCache,
    catchingUp: snapshot.fromCache && snapshot.connection !== ESessionConnection.Live,
    failedToLoad: snapshot.error !== undefined,
    stale: snapshot.skipped > 0,
    context: snapshot.view?.context ?? null,
    stagedRows,
    commands,
    operator,
    restored,
    notice,
    loadOlder,
    send,
    stop,
    retry,
    reconnect,
  }
}
