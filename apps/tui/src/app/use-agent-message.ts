import type { KeyEvent } from '@opentui/core'
import { useCallback, useState } from 'react'

import { isPrintable } from '../ui/keys/printable'

export type AgentMessageControl = {
  message: string | null
  handleKey: (key: KeyEvent) => boolean
}

/**
 * The message one types to a child while reading its transcript: `m` opens it, return sends it, and
 * every other key belongs to it until it closes. The host renders the text; this holds it.
 */
export function useAgentMessage(args: {
  viewing: string | null
  onSay: (sent: { agentId: string; text: string }) => void
}): AgentMessageControl {
  const [message, setMessage] = useState<string | null>(null)

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (args.viewing === null) return false
      if (message === null) {
        if (key.name !== 'm') return false
        setMessage('')
        return true
      }
      if (key.name === 'escape') {
        setMessage(null)
        return true
      }
      if (key.name === 'return') {
        args.onSay({ agentId: args.viewing, text: message })
        setMessage(null)
        return true
      }
      if (key.name === 'backspace') {
        setMessage(message.slice(0, -1))
        return true
      }
      if (isPrintable(key)) setMessage(message + (key.sequence ?? ''))
      return true
    },
    [args, message],
  )

  return { message, handleKey }
}
