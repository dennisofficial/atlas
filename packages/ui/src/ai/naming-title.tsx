'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '#lib/utils'
import { NAMING_SETTLE_MS, noiseLine, streamingLine } from './naming-frames'

const NOISE_LENGTH = 24
const SHUFFLE_MS = 80
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const REDUCED_MOTION_LABEL = 'Naming…'

export type NamingTitleProps = {
  title: string | null
  naming: boolean
  fallback?: string
  className?: string
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches

export function NamingTitle({
  title,
  naming,
  fallback = 'Untitled thread',
  className,
}: NamingTitleProps) {
  const generating = naming && title === null
  const [line, setLine] = useState<string | null>(generating ? '·'.repeat(NOISE_LENGTH) : null)
  const wasGenerating = useRef(generating)

  useEffect(() => {
    if (generating) {
      wasGenerating.current = true
      if (prefersReducedMotion()) {
        setLine(REDUCED_MOTION_LABEL)
        return undefined
      }
      setLine(noiseLine({ length: NOISE_LENGTH, random: Math.random }))
      const timer = setInterval(
        () => setLine(noiseLine({ length: NOISE_LENGTH, random: Math.random })),
        SHUFFLE_MS,
      )
      return () => clearInterval(timer)
    }
    if (title === null || !wasGenerating.current) {
      setLine(null)
      return undefined
    }
    wasGenerating.current = false
    if (prefersReducedMotion()) {
      setLine(null)
      return undefined
    }
    const startedAt = performance.now()
    let frame = 0
    const step = (now: number): void => {
      const elapsedMs = now - startedAt
      if (elapsedMs >= NAMING_SETTLE_MS) {
        setLine(null)
        return
      }
      setLine(
        streamingLine({
          title,
          startLength: NOISE_LENGTH,
          elapsedMs,
          settleMs: NAMING_SETTLE_MS,
          random: Math.random,
        }),
      )
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [generating, title])

  const animating = line !== null
  const reducedLabel = line === REDUCED_MOTION_LABEL
  return (
    <span aria-live="polite" aria-busy={generating} className={cn('block min-w-0', className)}>
      {generating ? <span className="sr-only">Naming thread</span> : null}
      {animating ? (
        <span
          aria-hidden
          className={cn(
            'block min-w-0 truncate text-muted-foreground',
            !reducedLabel && 'font-mono',
          )}
        >
          {line}
        </span>
      ) : (
        <span className="block min-w-0 truncate">{title ?? fallback}</span>
      )}
    </span>
  )
}
