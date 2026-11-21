import type { Dispatch, SetStateAction } from 'react'

import type { Handoff } from './composer-handoff'
import type { LiveSend } from './live-thread-view'
import type { useComposerAttachments } from './use-composer-attachments'

type Attachments = ReturnType<typeof useComposerAttachments>

type Send = (args: {
  threadId: string
  text: string
  attachments: Attachments['attachments']
  liveSend: LiveSend
  podState: string
  turnWasRunning: boolean
}) => Promise<Handoff | null>

export function useThreadSubmit(args: {
  threadId: string
  handleCommand: (text: string) => Promise<boolean>
  attachments: Attachments
  send: Send
  sendLive: LiveSend
  setDraft: Dispatch<SetStateAction<string>>
  onSent: (sent: Handoff) => void
  podState: string
  turnWasRunning: boolean
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
      attachments: attachments.attachments,
      liveSend: args.sendLive,
      podState: args.podState,
      turnWasRunning: args.turnWasRunning,
    })
    if (sent === null) return
    attachments.clear()
    args.onSent(sent)
  }
}
