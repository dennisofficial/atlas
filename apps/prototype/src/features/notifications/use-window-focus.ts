'use client'

import { useEffect, useState } from 'react'

const windowIsFocused = (): boolean => document.visibilityState === 'visible' && document.hasFocus()

export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const update = () => setFocused(windowIsFocused())
    update()
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return focused
}
