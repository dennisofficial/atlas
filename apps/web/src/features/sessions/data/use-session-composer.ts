import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { attachmentsOf } from '@dltech/atlas-core'
import { postInputOf } from '@dltech/atlas-client/session'
import { placementOf } from '@dltech/atlas-client/stream'

import { useComposerAttachments } from '@/features/threads/data/use-composer-attachments'
import { messageOf } from '@/features/threads/data/message-of'

import { sessionsApi } from './sessions-api'
import { useSessionAttachments } from './use-session-attachments'
import type { StagedDraft } from './use-staged-messages'

type Submission = {
  text: string
  stage: (staged: StagedDraft) => void
  onSent: (text: string) => void
}

export function useSessionComposer(args: { sessionId: string; working: boolean }) {
  const { sessionId, working } = args
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const retryClientId = useRef<string | undefined>(undefined)
  const files = useComposerAttachments()
  const attachments = useSessionAttachments({ files })

  const handleSubmit = async (submission: Submission) => {
    if (!attachments.checkSendable()) return
    const { media, uploads } = attachments
    if (submission.text.trim().length === 0 && media.length === 0 && uploads.length === 0) return
    const clientId = retryClientId.current ?? crypto.randomUUID()
    const at = new Date().toISOString()
    setSending(true)
    try {
      await sessionsApi.post({
        ...postInputOf({ sessionId, text: submission.text, clientId, media, uploads }),
        sentAt: at,
      })
      submission.stage({
        clientId,
        text: submission.text,
        attachments: [...media, ...attachmentsOf({ uploads })],
        placement: placementOf({ working }),
        at,
      })
      retryClientId.current = undefined
      setDraft('')
      attachments.clear()
      submission.onSent(submission.text)
    } catch (failure) {
      retryClientId.current = clientId
      toast.error(messageOf(failure))
    } finally {
      setSending(false)
    }
  }

  return { draft, setDraft, sending, handleSubmit, attachments }
}
