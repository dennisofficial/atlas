import { useEffect, useRef, useState } from 'react'

export function useOverflow(dep: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setOverflowing(node.scrollWidth > node.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [dep])

  return { ref, overflowing }
}
