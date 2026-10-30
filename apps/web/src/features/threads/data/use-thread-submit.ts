import type { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'

import type { EPodState, WireEvent } from '@dltech/atlas-wire/web'

import type { Handoff } from './composer-handoff'
import { TOO_LATE_NOTICE } from './composer-queue'
import type { LiveSend } from './live-thread-view'
import { ETakeBackOutcome, restoredDraftOf, takeBack, takeBackTargetOf } from './take-back'
import type { useComposerAttachments } from './use-composer-attachments'
import { messageOf } from './use-send'

type Send = (args: {
  threadId: string
  text: string
  images: ReturnType<typeof useComposerAttachments>['images']
  uploads: ReturnType<typeof useComposerAttachments>['uploads']
  liveSend: LiveSend
}) => Promise<Handoff | null>

export function useThreadSubmit(args: {
  threadId: string
  visible: WireEvent[]
  podState: EPodState | null
  attachments: ReturnType<typeof useComposerAttachments>
  send: Send
  sendLive: LiveSend
  onSent: (sent: Handoff) => void
  setDraft: Dispatch<SetStateAction<string>>
  setTakenBack: Dispatch<SetStateAction<ReadonlySet<string>>>
}) {
  const { threadId, visible, podState, attachments, send, sendLive, onSent } = args

  const handleSubmit = async (text: string) => {
    if (!attachments.checkSendable()) return
    const sent = await send({
      threadId,
      text,
      images: attachments.images,
      uploads: attachments.uploads,
      liveSend: sendLive,
    })
    if (sent === null) return
    attachments.clear()
    onSent(sent)
  }

  const handleEscape = async () => {
    const target = takeBackTargetOf({ events: visible, podState })
    if (target === null) return
    try {
      const outcome = await takeBack({ threadId, sendId: target.sendId })
      if (outcome === ETakeBackOutcome.TooLate) {
        toast(TOO_LATE_NOTICE)
        return
      }
      args.setTakenBack((current) => new Set(current).add(target.sendId))
      args.setDraft((current) => restoredDraftOf({ current, restored: target.text }))
      attachments.restore({ uploads: target.uploads, images: [] })
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  return { handleSubmit, handleEscape }
}
