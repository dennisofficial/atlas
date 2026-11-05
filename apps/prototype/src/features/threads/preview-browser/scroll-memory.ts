import { useLayoutEffect, useRef } from 'react'

const positions = new Map<string, number>()

export function useRememberedScroll(key: string) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = positions.get(key) ?? 0
  }, [key])
  const handleScroll = () => {
    if (ref.current) positions.set(key, ref.current.scrollTop)
  }
  return { ref, handleScroll }
}
