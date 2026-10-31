import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'

import type { EPodState, WireEvent } from '@dltech/atlas-wire/web'

import { TOO_LATE_NOTICE } from './composer-queue'
import {
  ETakeBackOutcome,
  restoredDraftOf,
  takeBack,
  takeBackTargetOf,
  withoutTakenBack,
} from './take-back'
import { messageOf } from './use-send'
import { useThreadBackend } from './use-thread-backend'
import type { TakenBack } from './live-thread-view'
import type { ThreadSource } from './thread-source'

export function useTakeBackEscape(args: {
  threadId: string
  events: WireEvent[]
  podState: EPodState | null
  setDraft: Dispatch<SetStateAction<string>>
  source: Pick<ThreadSource, 'takeBackPending'>
  onRestore: (taken: TakenBack) => void
}) {
  const backend = useThreadBackend()
  const [takenBack, setTakenBack] = useState<ReadonlySet<string>>(() => new Set())

  const visible = useMemo(
    () => withoutTakenBack({ events: args.events, sendIds: takenBack }),
    [args.events, takenBack],
  )

  const handleEscape = async () => {
    if (backend.local) {
      try {
        const taken = await args.source.takeBackPending()
        if (taken === null) return
        args.setDraft((current) => restoredDraftOf({ current, restored: taken.text }))
        args.onRestore(taken)
      } catch (failure) {
        toast.error(messageOf(failure))
      }
      return
    }
    const target = takeBackTargetOf({
      events: visible,
      podState: args.podState,
    })
    if (target === null) return
    try {
      const outcome = await takeBack({
        threadId: args.threadId,
        sendId: target.sendId,
      })
      if (outcome === ETakeBackOutcome.TooLate) {
        toast(TOO_LATE_NOTICE)
        return
      }
      setTakenBack((current) => new Set(current).add(target.sendId))
      args.setDraft((current) => restoredDraftOf({ current, restored: target.text }))
      args.onRestore({
        text: target.text,
        uploads: target.uploads,
        images: [],
      })
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  return { visible, handleEscape }
}
