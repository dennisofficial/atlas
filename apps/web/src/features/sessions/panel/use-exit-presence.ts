'use client'

import { useEffect, useRef, useState } from 'react'

export function useExitPresence<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null)
  const [mounted, setMounted] = useState(open)

  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open || !mounted) return
    const node = ref.current
    if (node === null || typeof node.getAnimations !== 'function') {
      setMounted(false)
      return
    }
    let cancelled = false
    const running = node.getAnimations().map((animation) => animation.finished)
    void Promise.allSettled(running).then(() => {
      if (!cancelled) setMounted(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, mounted])

  return { ref, mounted }
}
