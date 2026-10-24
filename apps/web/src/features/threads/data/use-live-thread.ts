import { useEffect, useMemo, useRef, useState } from 'react'

import { createLiveThreadController } from './live-thread-controller'
import {
  IDLE_LIVE_THREAD,
  type LiveChooseModel,
  type LiveSend,
  type LiveTakeBackPending,
  type LiveThreadState,
  type LiveThreadView,
  type ThreadModelChoice,
} from './live-thread-view'
import { connectPod } from './pod-connect'
import { fetchEvents, fetchThread } from './threads-api'

const NOT_LIVE: LiveSend = () => false
const NOT_CHOOSABLE: LiveChooseModel = async () => false
const NOT_TAKEABLE: LiveTakeBackPending = async () => null

export function useLiveThread(args: {
  threadId: string
  active: boolean
  onModelChanged?: ((model: ThreadModelChoice) => void) | undefined
}): LiveThreadView {
  const { threadId, active } = args
  const [state, setState] = useState<LiveThreadState>(IDLE_LIVE_THREAD)
  const sendRef = useRef<LiveSend>(NOT_LIVE)
  const chooseRef = useRef<LiveChooseModel>(NOT_CHOOSABLE)
  const takeBackRef = useRef<LiveTakeBackPending>(NOT_TAKEABLE)
  const modelChangedRef = useRef(args.onModelChanged)
  modelChangedRef.current = args.onModelChanged

  useEffect(() => {
    if (!active) return undefined
    const controller = createLiveThreadController({
      threadId,
      mint: () => connectPod(threadId),
      readSeed: () => fetchEvents(threadId),
      readStoredModel: async () => (await fetchThread(threadId)).model,
      onChange: setState,
      onModelChanged: (model) => modelChangedRef.current?.(model),
    })
    sendRef.current = controller.send
    chooseRef.current = controller.chooseModel
    takeBackRef.current = controller.takeBackPending
    controller.start()
    return () => {
      sendRef.current = NOT_LIVE
      chooseRef.current = NOT_CHOOSABLE
      takeBackRef.current = NOT_TAKEABLE
      controller.stop()
      setState(IDLE_LIVE_THREAD)
    }
  }, [threadId, active])

  const send = useMemo<LiveSend>(() => (sent) => sendRef.current(sent), [])
  const chooseModel = useMemo<LiveChooseModel>(() => (model) => chooseRef.current(model), [])
  const takeBackPending = useMemo<LiveTakeBackPending>(() => () => takeBackRef.current(), [])
  return { ...state, send, chooseModel, takeBackPending }
}
