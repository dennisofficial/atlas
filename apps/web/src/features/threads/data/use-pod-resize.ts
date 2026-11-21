import { useCallback } from 'react'

import { useThreadBackend } from './use-thread-backend'

export function usePodResize(args: { threadId: string; refresh: () => void }) {
  const { threadId, refresh } = args
  const { resize } = useThreadBackend()
  return useCallback(
    async (request: { vcpus: number }) => {
      try {
        await resize({ threadId, vcpus: request.vcpus })
      } finally {
        refresh()
      }
    },
    [threadId, refresh, resize],
  )
}
