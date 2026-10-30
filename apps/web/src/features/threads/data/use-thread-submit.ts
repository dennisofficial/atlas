import type { Dispatch, SetStateAction } from 'react'

import type { Handoff } from './composer-handoff'
import type { LiveSend } from './live-thread-view'
import type { useComposerAttachments } from './use-composer-attachments'

type Attachments = ReturnType<typeof useComposerAttachments>

type Send = (args: {
  threadId: string
  text: string
  images: Attachments['images']
  uploads: Attachments['uploads']
  liveSend: LiveSend
}) => Promise<Handoff | null>

export function useThreadSubmit(args: {
  threadId: string
  handleCommand: (text: string) => Promise<boolean>
  attachments: Attachments
  send: Send
  sendLive: LiveSend
  setDraft: Dispatch<SetStateAction<string>>
  onSent: (sent: Handoff) => void
}) {
  const { threadId, attachments } = args
  return async (text: string) => {
    if (await args.handleCommand(text)) {
      args.setDraft('')
      return
    }
    if (!attachments.checkSendable()) return
    const sent = await args.send({
      threadId,
      text,
      images: attachments.images,
      uploads: attachments.uploads,
      liveSend: args.sendLive,
    })
    if (sent === null) return
    attachments.clear()
    args.onSent(sent)
  }
}
