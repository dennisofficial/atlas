'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { DESKTOP_NAVIGATE_EVENT, isInAppPath } from '@dltech/atlas-wire/web'

export function desktopPathOf(event: Event): string | null {
  const detail = event instanceof CustomEvent ? event.detail : null
  return typeof detail === 'string' && isInAppPath(detail) ? detail : null
}

export function watchDesktopNavigation({
  host,
  navigate,
}: {
  host: object
  navigate: (path: string) => void
}): () => void {
  const bridge: unknown = Reflect.get(host, 'atlasDesktop')
  if (typeof bridge !== 'object' || bridge === null) return () => undefined
  const watch = Reflect.get(bridge, 'onNavigate')
  const unwatch = Reflect.get(bridge, 'offNavigate')
  if (typeof watch !== 'function' || typeof unwatch !== 'function') return () => undefined
  const handleNavigate = (path: unknown): boolean => {
    if (typeof path !== 'string' || !isInAppPath(path)) return false
    navigate(path)
    return true
  }
  watch.call(bridge, handleNavigate)
  return () => unwatch.call(bridge, handleNavigate)
}

export function useDesktopNavigation(desktop: boolean): void {
  const router = useRouter()
  useEffect(() => {
    if (!desktop) return
    const handleNavigate = (event: Event) => {
      const path = desktopPathOf(event)
      if (path !== null) router.push(path)
    }
    const unwatch = watchDesktopNavigation({ host: window, navigate: (path) => router.push(path) })
    window.addEventListener(DESKTOP_NAVIGATE_EVENT, handleNavigate)
    return () => {
      unwatch()
      window.removeEventListener(DESKTOP_NAVIGATE_EVENT, handleNavigate)
    }
  }, [desktop, router])
}
