import { useCallback } from 'react'

import { resizePod } from './threads-api'

export function usePodResize(args: { threadId: string; refresh: () => void }) {
  const { threadId, refresh } = args
  return useCallback(
    async (vcpus: number) => {
      try {
        await resizePod({ threadId, vcpus })
      } finally {
        refresh()
      }
    },
    [threadId, refresh],
  )
}
