'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { DESKTOP_NAVIGATE_EVENT, isInAppPath } from '@dltech/atlas-wire/web'

export function desktopPathOf(event: Event): string | null {
  const detail = event instanceof CustomEvent ? event.detail : null
  return typeof detail === 'string' && isInAppPath(detail) ? detail : null
}

export function useDesktopNavigation(desktop: boolean): void {
  const router = useRouter()
  useEffect(() => {
    if (!desktop) return
    const handleNavigate = (event: Event) => {
      const path = desktopPathOf(event)
      if (path !== null) router.push(path)
    }
    window.addEventListener(DESKTOP_NAVIGATE_EVENT, handleNavigate)
    return () => window.removeEventListener(DESKTOP_NAVIGATE_EVENT, handleNavigate)
  }, [desktop, router])
}
