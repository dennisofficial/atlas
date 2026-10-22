import { useEffect, useMemo, useRef, useState } from 'react'

import { createLiveThreadController } from './live-thread-controller'
import {
  IDLE_LIVE_THREAD,
  type LiveSend,
  type LiveThreadState,
  type LiveThreadView,
} from './live-thread-view'
import { connectPod } from './pod-connect'
import { fetchEvents } from './threads-api'

const NOT_LIVE: LiveSend = () => false

export function useLiveThread(args: { threadId: string; active: boolean }): LiveThreadView {
  const { threadId, active } = args
  const [state, setState] = useState<LiveThreadState>(IDLE_LIVE_THREAD)
  const sendRef = useRef<LiveSend>(NOT_LIVE)

  useEffect(() => {
    if (!active) return undefined
    const controller = createLiveThreadController({
      threadId,
      mint: () => connectPod(threadId),
      readSeed: () => fetchEvents(threadId),
      onChange: setState,
    })
    sendRef.current = controller.send
    controller.start()
    return () => {
      sendRef.current = NOT_LIVE
      controller.stop()
      setState(IDLE_LIVE_THREAD)
    }
  }, [threadId, active])

  const send = useMemo<LiveSend>(() => (sent) => sendRef.current(sent), [])
  return { ...state, send }
}
