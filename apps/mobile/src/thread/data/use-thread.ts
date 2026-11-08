import type { ChannelSignal, StepSignal } from '@dltech/atlas-client/channel'
import type { OperatorInputRequestWire } from '@dltech/atlas-wire/web'
import { randomUUID } from 'expo-crypto'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { openThreadChannel, type ThreadChannel } from './channel'
import { headSeqOf, readEvents } from './events'
import { INITIAL_THREAD_STATE, threadReducer, viewOf, type ThreadView } from './thread-state'

const TICK_MS = 1000

const isStepSignal = (signal: ChannelSignal): signal is StepSignal =>
  signal.type === 'turn-working' ||
  signal.type === 'step-started' ||
  signal.type === 'chunk' ||
  signal.type === 'step-ended' ||
  signal.type === 'tool-output'

export type LiveThread = ThreadView & {
  now: number
  loaded: boolean
  failedToLoad: boolean
  connection: string | null
  title: string | null
  operatorInput: OperatorInputRequestWire | null
  send: (text: string) => Promise<boolean>
  stop: () => void
  retry: () => void
  submitOperatorInput: (value: string) => Promise<string | null>
}

export function useThread(threadId: string | undefined): LiveThread {
  const { api } = useAuth()
  const [state, dispatch] = useReducer(threadReducer, INITIAL_THREAD_STATE)
  const [now, setNow] = useState(() => Date.now())
  const channelRef = useRef<ThreadChannel | null>(null)
  const headRef = useRef(0)
  const readingRef = useRef(false)
  const wantedRef = useRef(false)

  headRef.current = headSeqOf(state.events)

  const refresh = useCallback(
    async (options?: { full?: boolean }) => {
      if (api === undefined || threadId === undefined) return
      if (readingRef.current) {
        wantedRef.current = true
        return
      }
      readingRef.current = true
      try {
        const full = options?.full === true
        const incoming = await readEvents({
          api,
          threadId,
          ...(full ? {} : { fromSeq: headRef.current }),
        })
        dispatch(
          full ? { type: 'replace', events: incoming } : { type: 'events', events: incoming },
        )
      } catch {
        return
      } finally {
        readingRef.current = false
      }
      if (wantedRef.current) {
        wantedRef.current = false
        void refresh(options)
      }
    },
    [api, threadId],
  )

  useEffect(() => {
    if (api === undefined || threadId === undefined) return undefined
    let cancelled = false
    const start = async () => {
      try {
        const [thread, events] = await Promise.all([
          api.threads.get.query({ threadId }),
          readEvents({ api, threadId }),
        ])
        if (cancelled) return
        dispatch({
          type: 'seed',
          events,
          title: thread.title ?? null,
          working: thread.status?.working ?? false,
        })
        const channel = await openThreadChannel({
          api,
          threadId,
          headSeq: () => headRef.current,
          handlers: {
            onSignal: (signal) => {
              if (isStepSignal(signal)) dispatch({ type: 'signal', signal })
              if (signal.type === 'events-appended') void refresh()
              if (signal.type === 'operator-input')
                dispatch({ type: 'operator-input', request: signal.request })
            },
            onConnection: (view) => {
              dispatch({ type: 'connection', connection: view.state })
            },
            onReload: () => void refresh({ full: true }),
            onRenamed: (title) => dispatch({ type: 'rename', title }),
          },
        })
        if (cancelled) {
          channel?.close()
          return
        }
        channelRef.current = channel
      } catch {
        if (!cancelled) dispatch({ type: 'failed' })
      }
    }
    void start()
    return () => {
      cancelled = true
      channelRef.current?.close()
      channelRef.current = null
    }
  }, [api, threadId, refresh])

  useEffect(() => {
    if (!state.working) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [state.working])

  useEffect(() => {
    if (state.working) return undefined
    if (state.loaded) void refresh()
    return undefined
  }, [state.working, state.loaded, refresh])

  useEffect(() => {
    if (api === undefined || threadId === undefined || !state.loaded) return
    if (state.working) return
    void api.threads.markRead.mutate({ threadId, seq: headRef.current }).catch(() => undefined)
  }, [api, threadId, state.loaded, state.working, state.events])

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (api === undefined || threadId === undefined) return false
      const trimmed = text.trim()
      if (trimmed.length === 0) return false
      const sendId = randomUUID()
      const channel = channelRef.current
      if (channel?.send({ text: trimmed, requestId: sendId })) return true
      try {
        await api.threadMessages.send.mutate({ threadId, sendId, text: trimmed })
      } catch {
        return false
      }
      void refresh()
      return true
    },
    [api, threadId, refresh],
  )

  const stop = useCallback(() => {
    channelRef.current?.interrupt()
  }, [])

  const retry = useCallback(() => {
    channelRef.current?.retry()
  }, [])

  const submitOperatorInput = useCallback(
    async (value: string): Promise<string | null> => {
      const channel = channelRef.current
      const request = state.operatorInput
      if (channel === null || request === null)
        return "Atlas isn't connected to this session right now."
      const notice = await channel.provideOperatorInput({ requestId: request.requestId, value })
      if (notice === null) dispatch({ type: 'operator-input', request: null })
      return notice
    },
    [state.operatorInput],
  )

  const view = useMemo(() => viewOf({ state, now }), [state, now])

  return {
    ...view,
    now,
    loaded: state.loaded,
    failedToLoad: state.failed,
    connection: state.connection,
    title: state.title,
    operatorInput: state.operatorInput,
    send,
    stop,
    retry,
    submitOperatorInput,
  }
}
