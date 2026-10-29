import { useEffect } from 'react'

import { activeNaming } from '@/features/shell/active-naming'

export function usePublishNaming(args: {
  threadId: string
  title: string | null
  naming: boolean
}) {
  const { threadId, title, naming } = args
  useEffect(() => {
    activeNaming.publish({ threadId, title, naming })
  }, [threadId, title, naming])
  useEffect(() => () => activeNaming.clear(threadId), [threadId])
}
