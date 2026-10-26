import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { nextStuck } from '../agents-panel-scroll'

export function useStickToBottom(scrollRef: RefObject<HTMLElement | null>): RefObject<boolean> {
  const stuckRef = useRef(true)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    let previousTop = element.scrollTop
    const handleScroll = () => {
      stuckRef.current = nextStuck({
        stuck: stuckRef.current,
        previousTop,
        scrollTop: element.scrollTop,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })
      previousTop = element.scrollTop
    }
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [scrollRef])

  return stuckRef
}
