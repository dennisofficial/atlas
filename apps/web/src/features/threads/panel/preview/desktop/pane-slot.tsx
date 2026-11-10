'use client'

import { useEffect, useRef, useState } from 'react'

import { sendPaneCommand } from './pane-client'
import { createPaneSync, type PaneSync } from './pane-sync'

export function PaneSlot(props: { id: string; url: string }) {
  const { id, url } = props
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const sync = useRef<PaneSync | undefined>(undefined)
  const latest = useRef(url)

  useEffect(() => {
    latest.current = url
  }, [url])

  useEffect(() => {
    if (element === null) return
    const held = createPaneSync({
      element,
      id,
      url: latest.current,
      send: (command) => sendPaneCommand({ id, command }),
    })
    sync.current = held
    return () => {
      held.stop()
      sync.current = undefined
    }
  }, [element, id])

  useEffect(() => {
    sync.current?.apply(url)
  }, [url])

  return <div ref={setElement} className="size-full" />
}
