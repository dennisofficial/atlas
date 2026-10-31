'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { localThreadOf } from '@/features/desktop/local-thread'
import { subscribeLocalThreadMetadata } from '@/features/desktop/local-thread-feed'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'
import { usePageVisible } from '@/lib/use-page-visible'

import type { ThreadDisplay } from './thread-display'
import { useThreadBackend } from './use-thread-backend'

export function useThreadQuery(threadId: string): CloudQuery<ThreadDisplay> {
  const backend = useThreadBackend()
  const client = useQueryClient()
  const visible = usePageVisible()
  const key = `thread:${threadId}`
  const query = useCloudQuery({ key, load: () => backend.fetchThread(threadId) })

  useEffect(() => {
    if (!backend.local || !visible) return undefined
    return subscribeLocalThreadMetadata({
      threadId,
      listener: (thread) => {
        client.setQueryData([key], { value: localThreadOf(thread) })
      },
    })
  }, [backend.local, client, key, threadId, visible])

  return query
}
