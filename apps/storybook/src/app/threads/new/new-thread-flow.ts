import { useEffect, useState } from 'react'

import type { QueuedMessage } from '@dltech/atlas-ui/ai/task-dock'

import {
  FIRST_TURN_STEPS,
  POD_DELAY_MS,
  REPLY_WORDS,
  SETTLE_DELAY_MS,
  STEP_DELAYS_MS,
} from './new-thread-data'
import { seededCore, seededElapsed, seededTurn } from './new-thread-seed'
import {
  advancePod,
  retryFrom,
  sendFrom,
  takeBackFrom,
  type ThreadCore,
} from './new-thread-transitions'
import { EFirstMessage, ENewThreadOutcome, EPodProgress, isStartingPod } from './new-thread-types'

export interface NewThreadFlowOptions {
  initialPod: EPodProgress
  initialMessage: EFirstMessage
  initialProjectId: string | null
  outcome: ENewThreadOutcome
  autoRun: boolean
}

export interface NewThreadFlow extends ThreadCore {
  projectId: string | null
  elapsed: number
  visibleSteps: number
  replyWords: number
  queued: QueuedMessage[]
  handleDraftChange: (value: string) => void
  handleProjectChange: (projectId: string | null) => void
  handleSend: (text: string) => void
  handleTakeBack: () => void
  handleRetry: () => void
  handleRemoveQueued: (id: string) => void
}

const STEP_COUNT = FIRST_TURN_STEPS.length

export function useNewThreadFlow({
  initialPod,
  initialMessage,
  initialProjectId,
  outcome,
  autoRun,
}: NewThreadFlowOptions): NewThreadFlow {
  const seededProgress = seededTurn(initialMessage)
  const [core, setCore] = useState(() => seededCore({ pod: initialPod, message: initialMessage }))
  const [projectId, setProjectId] = useState(initialProjectId)
  const [elapsed, setElapsed] = useState(seededElapsed(initialPod))
  const [visibleSteps, setVisibleSteps] = useState(seededProgress.steps)
  const [replyWords, setReplyWords] = useState(seededProgress.words)
  const [queued, setQueued] = useState<QueuedMessage[]>([])
  const { pod, message } = core

  useEffect(() => {
    const delay = POD_DELAY_MS[pod]
    if (!autoRun || delay === undefined) return undefined
    const timer = setTimeout(
      () => setCore((previous) => advancePod({ core: previous, outcome })),
      delay,
    )
    return () => clearTimeout(timer)
  }, [autoRun, pod, outcome])

  useEffect(() => {
    if (!autoRun || !isStartingPod(pod)) return undefined
    const interval = setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(interval)
  }, [autoRun, pod])

  useEffect(() => {
    if (!autoRun || message !== EFirstMessage.Running) return undefined
    if (visibleSteps < STEP_COUNT) {
      const timer = setTimeout(
        () => setVisibleSteps((count) => count + 1),
        STEP_DELAYS_MS[visibleSteps] ?? 700,
      )
      return () => clearTimeout(timer)
    }
    if (replyWords < REPLY_WORDS.length) {
      const timer = setTimeout(() => setReplyWords((count) => count + 1), 45)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(
      () => setCore((previous) => ({ ...previous, message: EFirstMessage.Done })),
      SETTLE_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [autoRun, message, visibleSteps, replyWords])

  const handleDraftChange = (value: string) =>
    setCore((previous) => ({ ...previous, draft: value }))

  const handleProjectChange = (next: string | null) => setProjectId(next)

  const handleSend = (text: string) => {
    const started = sendFrom({ core, text, outcome })
    if (started) {
      if (started.pod !== pod) setElapsed(0)
      setVisibleSteps(0)
      setReplyWords(0)
      setCore(started)
      return
    }
    setQueued((previous) => [...previous, { id: `q-${previous.length + 1}-${text.length}`, text }])
  }

  const handleTakeBack = () => setCore(takeBackFrom(core))

  const handleRetry = () => {
    setElapsed(0)
    setCore(retryFrom({ core, outcome }))
  }

  const handleRemoveQueued = (id: string) =>
    setQueued((previous) => previous.filter((entry) => entry.id !== id))

  return {
    ...core,
    projectId,
    elapsed,
    visibleSteps,
    replyWords,
    queued,
    handleDraftChange,
    handleProjectChange,
    handleSend,
    handleTakeBack,
    handleRetry,
    handleRemoveQueued,
  }
}
