'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import {
  type ChromeMessage,
  type ControlValue,
  EProtoMessage,
  type ETheme,
  parsePageMessage,
} from './bridge-messages'
import { splitFramePath } from './frame-path'
import type { Control } from './use-prototype'

export interface AnnouncedControls {
  path: string
  controls: Record<string, Control>
  values: Record<string, ControlValue>
}

function samePathname({ a, b }: { a: string; b: string }): boolean {
  return splitFramePath(a).pathname === splitFramePath(b).pathname
}

export function useFrameBridge({
  iframeRef,
  initialPath,
  theme,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  initialPath: string
  theme: ETheme
}) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [announced, setAnnounced] = useState<AnnouncedControls | null>(null)
  const themeRef = useRef(theme)
  themeRef.current = theme

  const post = useCallback(
    (message: ChromeMessage) => {
      iframeRef.current?.contentWindow?.postMessage(message, window.location.origin)
    },
    [iframeRef],
  )

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = parsePageMessage(event.data)
      if (!message) return
      setCurrentPath(message.path)
      if (message.kind === EProtoMessage.Controls) {
        setAnnounced({ path: message.path, controls: message.controls, values: message.values })
        return
      }
      setAnnounced((previous) =>
        previous && samePathname({ a: previous.path, b: message.path }) ? previous : null,
      )
      post({ kind: EProtoMessage.Theme, theme: themeRef.current })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [iframeRef, post])

  useEffect(() => {
    post({ kind: EProtoMessage.Theme, theme })
  }, [theme, post])

  const navigate = useCallback((path: string) => {
    setCurrentPath(path)
    setAnnounced(null)
  }, [])

  const setControl = useCallback(
    ({ key, value }: { key: string; value: ControlValue }) => {
      post({ kind: EProtoMessage.Set, key, value })
    },
    [post],
  )

  const resetControls = useCallback(() => post({ kind: EProtoMessage.Reset }), [post])

  return { currentPath, announced, navigate, setControl, resetControls }
}
