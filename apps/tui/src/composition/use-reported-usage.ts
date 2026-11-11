import { contextTokens, type ModelUsage, type ThreadId } from '@dltech/atlas-core'
import { useCallback, useState } from 'react'

type Reported = { threadId: ThreadId; usage: ModelUsage }

export function useReportedUsage(args: { threadId: ThreadId }): {
  setReported: (next: Reported | null) => void
  forgetUsage: () => void
  usedTokens: () => number | null
  reported: Reported | null
} {
  const { threadId } = args
  const [reported, setReported] = useState<Reported | null>(null)
  const forgetUsage = useCallback(() => setReported(null), [])
  const usedTokens = useCallback(
    (): number | null =>
      reported === null || reported.threadId !== threadId ? null : contextTokens(reported.usage),
    [reported, threadId],
  )
  return { setReported, forgetUsage, usedTokens, reported }
}
