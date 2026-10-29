import { Chat, useChat } from '@ai-sdk/react'
import { stepsOfMessages, type AtlasStepMessage } from '@dltech/atlas-client/chat'
import { useEffect, useMemo, useRef, useState } from 'react'

import { eventsFromWire } from './events-from-wire'
import { createLiveChatSession, type LiveChatSession } from './live-chat-session'
import {
  IDLE_LIVE_THREAD,
  type LiveChooseModel,
  type LiveInterrupt,
  type LiveSend,
  type LiveTakeBackPending,
  type LiveThreadState,
  type LiveThreadView,
  type ThreadModelChoice,
} from './live-thread-view'
import { connectPod } from './pod-connect'
import { fetchEvents, fetchThread } from './threads-api'

const CHAT_THROTTLE_MS = 16
const NOT_LIVE: LiveSend = () => false
const NOT_CHOOSABLE: LiveChooseModel = async () => false
const NOT_TAKEABLE: LiveTakeBackPending = async () => null
const NOT_INTERRUPTIBLE: LiveInterrupt = () => false

export function useLiveThread(args: {
  threadId: string
  active: boolean
  onModelChanged?: ((model: ThreadModelChoice) => void) | undefined
}): LiveThreadView {
  const { threadId, active } = args
  const [state, setState] = useState<LiveThreadState>(IDLE_LIVE_THREAD)
  const [idleChat] = useState(() => new Chat<AtlasStepMessage>({}))
  const [session, setSession] = useState<LiveChatSession | null>(null)
  const sendRef = useRef<LiveSend>(NOT_LIVE)
  const chooseRef = useRef<LiveChooseModel>(NOT_CHOOSABLE)
  const takeBackRef = useRef<LiveTakeBackPending>(NOT_TAKEABLE)
  const interruptRef = useRef<LiveInterrupt>(NOT_INTERRUPTIBLE)
  const modelChangedRef = useRef(args.onModelChanged)
  useEffect(() => {
    modelChangedRef.current = args.onModelChanged
  })

  useEffect(() => {
    if (!active) return undefined
    const next = createLiveChatSession({
      threadId,
      mint: () => connectPod(threadId),
      readSeed: () => fetchEvents(threadId),
      readStoredModel: async () => (await fetchThread(threadId)).model,
      onChange: setState,
      onModelChanged: (model) => modelChangedRef.current?.(model),
    })
    sendRef.current = next.controller.send
    chooseRef.current = next.controller.chooseModel
    takeBackRef.current = next.controller.takeBackPending
    interruptRef.current = next.controller.interrupt
    setSession(next)
    next.controller.start()
    return () => {
      sendRef.current = NOT_LIVE
      chooseRef.current = NOT_CHOOSABLE
      takeBackRef.current = NOT_TAKEABLE
      interruptRef.current = NOT_INTERRUPTIBLE
      next.controller.stop()
      setSession(null)
      setState(IDLE_LIVE_THREAD)
    }
  }, [threadId, active])

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
  return { ...state, steps, send, chooseModel, takeBackPending, interrupt }
}
