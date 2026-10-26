'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createElement, Suspense, useEffect, useRef } from 'react'

import {
  applyControlMessage,
  EProtoMessage,
  ETheme,
  parseChromeMessage,
  toControlValues,
} from './bridge-messages'
import { isEmbedded, isFromParent, postToParent } from './frame-io'
import { joinPath } from './frame-path'
import type { Control, Values } from './use-prototype'

export function useAnnounceControls<C extends Record<string, Control>>({
  controls,
  values,
}: {
  controls: C
  values: Values<C>
}): void {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const router = useRouter()
  const controlsRef = useRef<Record<string, Control>>(controls)
  controlsRef.current = controls
  const announced = toControlValues(values)
  const signature = JSON.stringify({ controls, announced })

  useEffect(() => {
    postToParent({
      kind: EProtoMessage.Controls,
      path: joinPath({ pathname, search }),
      controls: controlsRef.current,
      values: announced,
    })
  }, [pathname, search, signature])

  useEffect(() => {
    if (!isEmbedded()) return
    const handleMessage = (event: MessageEvent) => {
      if (!isFromParent(event)) return
      const message = parseChromeMessage(event.data)
      if (!message || message.kind === EProtoMessage.Theme) return
      const next = applyControlMessage({
        search: window.location.search.slice(1),
        controls: controlsRef.current,
        message,
      })
      if (next === null) return
      const current = window.location.pathname
      router.replace(joinPath({ pathname: current, search: next }), { scroll: false })
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [router])
}

function FrameListener() {
  const pathname = usePathname()
  const search = useSearchParams().toString()

  useEffect(() => {
    postToParent({ kind: EProtoMessage.Location, path: joinPath({ pathname, search }) })
  }, [pathname, search])

  useEffect(() => {
    if (!isEmbedded()) return
    const handleMessage = (event: MessageEvent) => {
      if (!isFromParent(event)) return
      const message = parseChromeMessage(event.data)
      if (!message || message.kind !== EProtoMessage.Theme) return
      const isLight = message.theme === ETheme.Light
      const root = document.documentElement
      root.classList.toggle('light', isLight)
      root.style.colorScheme = message.theme
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return null
}

export function ProtoFrameListener() {
  return createElement(Suspense, { fallback: null }, createElement(FrameListener))
}
