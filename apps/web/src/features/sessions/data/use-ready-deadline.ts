'use client'

import { useCallback, useEffect, useState } from 'react'

export const POD_READY_DEADLINE_MS = 60_000

export function useReadyDeadline(args: { waiting: boolean; deadlineMs?: number | undefined }): {
  stalled: boolean
  restart: () => void
} {
  const deadlineMs = args.deadlineMs ?? POD_READY_DEADLINE_MS
  const [stalled, setStalled] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    setStalled(false)
    if (!args.waiting) return undefined
    const timer = setTimeout(() => setStalled(true), deadlineMs)
    return () => clearTimeout(timer)
  }, [args.waiting, deadlineMs, round])

  const restart = useCallback(() => setRound((current) => current + 1), [])
  return { stalled: args.waiting && stalled, restart }
}
