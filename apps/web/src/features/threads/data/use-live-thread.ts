import { useEffect, useMemo, useRef, useState } from 'react'

import { createLiveThreadController } from './live-thread-controller'
import {
  IDLE_LIVE_THREAD,
  type LiveChooseModel,
  type LiveSend,
  type LiveThreadState,
  type LiveThreadView,
  type ThreadModelChoice,
} from './live-thread-view'
import { connectPod } from './pod-connect'
import { fetchEvents } from './threads-api'

const NOT_LIVE: LiveSend = () => false
const NOT_CHOOSABLE: LiveChooseModel = async () => false

export function useLiveThread(args: {
  threadId: string
  active: boolean
  onModelChanged?: ((model: ThreadModelChoice) => void) | undefined
}): LiveThreadView {
  const { threadId, active } = args
  const [state, setState] = useState<LiveThreadState>(IDLE_LIVE_THREAD)
  const sendRef = useRef<LiveSend>(NOT_LIVE)
  const chooseRef = useRef<LiveChooseModel>(NOT_CHOOSABLE)
  const modelChangedRef = useRef(args.onModelChanged)
  modelChangedRef.current = args.onModelChanged

  useEffect(() => {
    if (!active) return undefined
    const controller = createLiveThreadController({
      threadId,
      mint: () => connectPod(threadId),
      readSeed: () => fetchEvents(threadId),
      onChange: setState,
      onModelChanged: (model) => modelChangedRef.current?.(model),
    })
    sendRef.current = controller.send
    chooseRef.current = controller.chooseModel
    controller.start()
    return () => {
      sendRef.current = NOT_LIVE
      chooseRef.current = NOT_CHOOSABLE
      controller.stop()
      setState(IDLE_LIVE_THREAD)
    }
  }, [threadId, active])

  const send = useMemo<LiveSend>(() => (sent) => sendRef.current(sent), [])
  const chooseModel = useMemo<LiveChooseModel>(() => (model) => chooseRef.current(model), [])
  return { ...state, send, chooseModel }
}
