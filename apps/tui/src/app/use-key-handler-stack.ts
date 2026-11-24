import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useRef } from 'react'

/**
 * One key handler handed to the renderer, reading the current three through refs so a key always
 * reaches the handler of the latest render: the agent's, then the panel's, then the chat's.
 */
export function useKeyHandlerStack(args: {
  chat: (key: KeyEvent) => boolean
  agent: (key: KeyEvent) => boolean
  panels: (key: KeyEvent) => boolean
  onKeys: (handler: (key: KeyEvent) => boolean) => void
}): void {
  const chatKeys = useRef(args.chat)
  chatKeys.current = args.chat
  const agentKeys = useRef(args.agent)
  agentKeys.current = args.agent
  const panelKeys = useRef(args.panels)
  panelKeys.current = args.panels

  const withPanels = useCallback((key: KeyEvent): boolean => {
    if (agentKeys.current(key)) return true
    if (panelKeys.current(key)) return true
    chatKeys.current(key)
    return true
  }, [])

  const onKeys = args.onKeys
  useEffect(() => {
    onKeys(withPanels)
  }, [onKeys, withPanels])
}
