import { useRef, useState } from 'react'

import type { QueuedMessageEntry, QueuedMessageSave } from '@dltech/atlas-ui/ai/queued-messages'

export function useQueuedMessages(initial: QueuedMessageEntry[]) {
  const [queued, setQueued] = useState(initial)
  const nextId = useRef(initial.length)

  const handleAppend = (text: string) => {
    nextId.current += 1
    const id = `q-${nextId.current}`
    setQueued((previous) => [...previous, { id, text, attachments: [] }])
  }

  const handleSave = ({ id, text, attachments }: QueuedMessageSave) =>
    setQueued((previous) =>
      previous.map((message) => (message.id === id ? { ...message, text, attachments } : message)),
    )

  const handleRemove = (id: string) =>
    setQueued((previous) => previous.filter((message) => message.id !== id))

  return { queued, handleAppend, handleSave, handleRemove }
}
