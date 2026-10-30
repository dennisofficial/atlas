import { Chat, useChat } from '@ai-sdk/react'
import { stepsOfMessages, type AtlasStepMessage } from '@dltech/atlas-client/chat'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { eventsFromWire } from './events-from-wire'
import { createLiveChatSession, type LiveChatSession } from './live-chat-session'
import {
  IDLE_LIVE_THREAD,
  type LiveApplyRewind,
  type LiveChooseModel,
  type LiveDismissFailure,
  type LiveInterrupt,
  type LiveReadRoster,
  type LiveRetry,
  type LiveSend,
  type LiveTakeBackPending,
  type LiveThreadState,
  type LiveThreadView,
  type ThreadModelChoice,
} from './live-thread-view'
import { useThreadBackend } from './use-thread-backend'

const CHAT_THROTTLE_MS = 16
const NOT_LIVE: LiveSend = () => false
const NOT_CHOOSABLE: LiveChooseModel = async () => false
const NOT_TAKEABLE: LiveTakeBackPending = async () => null
const NOT_INTERRUPTIBLE: LiveInterrupt = () => false
const NOT_RETRYABLE: LiveRetry = () => false
const NOT_DISMISSIBLE: LiveDismissFailure = () => false
const NOT_REWINDING: LiveApplyRewind = async () => {
  throw new Error('the sandbox is not connected')
}
const NOT_READING_ROSTER: LiveReadRoster = async () => null
export const INTERRUPT_LOST =
  'The sandbox never acknowledged the stop, so the turn may still be running'

export function useLiveThread(args: {
  threadId: string
  active: boolean
  onModelChanged?: ((model: ThreadModelChoice) => void) | undefined
}): LiveThreadView {
  const { threadId, active } = args
  const backend = useThreadBackend()
  const [state, setState] = useState<LiveThreadState>(IDLE_LIVE_THREAD)
  const [idleChat] = useState(() => new Chat<AtlasStepMessage>({}))
  const [session, setSession] = useState<LiveChatSession | null>(null)
  const sendRef = useRef<LiveSend>(NOT_LIVE)
  const chooseRef = useRef<LiveChooseModel>(NOT_CHOOSABLE)
  const takeBackRef = useRef<LiveTakeBackPending>(NOT_TAKEABLE)
  const interruptRef = useRef<LiveInterrupt>(NOT_INTERRUPTIBLE)
  const retryRef = useRef<LiveRetry>(NOT_RETRYABLE)
  const dismissRef = useRef<LiveDismissFailure>(NOT_DISMISSIBLE)
  const rewindRef = useRef<LiveApplyRewind>(NOT_REWINDING)
  const rosterRef = useRef<LiveReadRoster>(NOT_READING_ROSTER)
  const modelChangedRef = useRef(args.onModelChanged)
  useEffect(() => {
    modelChangedRef.current = args.onModelChanged
  })

  useEffect(() => {
    if (!active) return undefined
    const next = createLiveChatSession({
      threadId,
      mint: () => backend.mint(threadId),
      readSeed: () => backend.fetchEvents(threadId),
      catchUpOnConnect: backend.local,
      ...(backend.local
        ? {}
        : {
            readStoredModel: async () => (await backend.fetchThread(threadId)).model,
          }),
      onChange: setState,
      onModelChanged: (model) => modelChangedRef.current?.(model),
      onInterruptLost: () => toast.error(INTERRUPT_LOST),
    })
    sendRef.current = next.controller.send
    chooseRef.current = next.controller.chooseModel
    takeBackRef.current = next.controller.takeBackPending
    interruptRef.current = next.controller.interrupt
    retryRef.current = next.controller.retry
    dismissRef.current = next.controller.dismissFailure
    rewindRef.current = next.controller.applyRewind
    rosterRef.current = next.controller.readRoster
    setSession(next)
    next.controller.start()
    return () => {
      sendRef.current = NOT_LIVE
      chooseRef.current = NOT_CHOOSABLE
      takeBackRef.current = NOT_TAKEABLE
      interruptRef.current = NOT_INTERRUPTIBLE
      retryRef.current = NOT_RETRYABLE
      dismissRef.current = NOT_DISMISSIBLE
      rewindRef.current = NOT_REWINDING
      rosterRef.current = NOT_READING_ROSTER
      next.controller.stop()
      setSession(null)
      setState(IDLE_LIVE_THREAD)
    }
  }, [threadId, active, backend])

  const chat = session?.chat ?? idleChat
  const { messages } = useChat({ chat, throttle: CHAT_THROTTLE_MS })
  const steps = useMemo(() => stepsOfMessages(messages), [messages])

  useEffect(() => {
    session?.pruneTo(eventsFromWire(state.events))
  }, [session, state.events])

  const send = useMemo<LiveSend>(() => (sent) => sendRef.current(sent), [])
  const chooseModel = useMemo<LiveChooseModel>(() => (model) => chooseRef.current(model), [])
  const takeBackPending = useMemo<LiveTakeBackPending>(() => () => takeBackRef.current(), [])
  const interrupt = useMemo<LiveInterrupt>(() => () => interruptRef.current(), [])
  const retry = useMemo<LiveRetry>(() => (runArgs) => retryRef.current(runArgs), [])
  const dismissFailure = useMemo<LiveDismissFailure>(
    () => (dismissal) => dismissRef.current(dismissal),
    [],
  )
  const applyRewind = useMemo<LiveApplyRewind>(() => (picked) => rewindRef.current(picked), [])
  const readRoster = useMemo<LiveReadRoster>(() => () => rosterRef.current(), [])
  return {
    ...state,
    steps,
    send,
    chooseModel,
    takeBackPending,
    interrupt,
    retry,
    dismissFailure,
    applyRewind,
    readRoster,
  }
}
