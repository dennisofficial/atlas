import type { KeyEvent } from '@opentui/core'
import { useCallback, useState } from 'react'

export type OpenPanel = { open: boolean; index: number }

export type OpenPanelControl = {
  panel: OpenPanel
  handleOpen: () => void
  handleClose: () => void
  handleIndex: (index: number) => void
  handleMove: (key: KeyEvent, count: number) => boolean
}

const CLOSED: OpenPanel = { open: false, index: 0 }

export function useOpenPanel(): OpenPanelControl {
  const [panel, setPanel] = useState<OpenPanel>(CLOSED)

  const handleOpen = useCallback(() => setPanel({ open: true, index: 0 }), [])
  const handleClose = useCallback(() => setPanel(CLOSED), [])

  const handleIndex = useCallback((index: number) => {
    setPanel((current) => (current.open ? { ...current, index } : current))
  }, [])

  const handleMove = useCallback((key: KeyEvent, count: number): boolean => {
    if (key.name !== 'up' && key.name !== 'down') return false
    setPanel((current) => {
      if (!current.open || count === 0) return current
      const next = current.index + (key.name === 'up' ? -1 : 1)
      return { ...current, index: Math.min(Math.max(next, 0), count - 1) }
    })
    return true
  }, [])

  return { panel, handleOpen, handleClose, handleIndex, handleMove }
}
