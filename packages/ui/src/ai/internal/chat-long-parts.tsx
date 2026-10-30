import { useEffect, useState } from 'react'

import { Button } from '#components/button'

import { AgentMessage } from '../message'
import { MessageResponse } from '../message-response'

export const STREAM_WORDS =
  'Streaming a reply that keeps growing so the view has to keep following the bottom while new words land every tick. '.repeat(
    12,
  )

const STREAM_TICK_MS = 60
const STREAM_STEP = 24

export function useStreamReply() {
  const [length, setLength] = useState<number | null>(null)
  useEffect(() => {
    if (length === null || length >= STREAM_WORDS.length) return
    const timer = setTimeout(() => setLength(length + STREAM_STEP), STREAM_TICK_MS)
    return () => clearTimeout(timer)
  }, [length])
  const start = () => setLength(STREAM_STEP)
  return { text: length === null ? null : STREAM_WORDS.slice(0, length), start }
}

export function StreamingReply({ text }: { text: string }) {
  return (
    <AgentMessage streaming>
      <MessageResponse>{text}</MessageResponse>
    </AgentMessage>
  )
}

export function StreamButton({ onStream }: { onStream: () => void }) {
  return (
    <div className="flex gap-2 p-3">
      <Button size="sm" variant="outline" onClick={onStream}>
        Stream reply
      </Button>
    </div>
  )
}
