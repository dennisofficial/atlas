import { contextTokens, type ModelUsage, type ThreadId } from '@dltech/atlas-core'
import { useCallback, useState } from 'react'

type Reported = { threadId: ThreadId; usage: ModelUsage }

export function useReportedUsage(args: { threadId: ThreadId }): {
  setReported: (next: Reported | null) => void
  forgetUsage: () => void
  usedTokens: (logTokens: number) => number
  reported: Reported | null
} {
  const { threadId } = args
  const [reported, setReported] = useState<Reported | null>(null)
  const forgetUsage = useCallback(() => setReported(null), [])
  const usedTokens = useCallback(
    (logTokens: number): number =>
      reported === null || reported.threadId !== threadId
        ? logTokens
        : contextTokens({ reported: reported.usage, events: [] }),
    [reported, threadId],
  )
  return { setReported, forgetUsage, usedTokens, reported }
}
