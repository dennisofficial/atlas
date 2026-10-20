import type { ThreadId } from '@dltech/atlas-core'
import { useEffect } from 'react'

import type { AtlasApp } from './compose'
import { useSessionOwner } from './use-session-owner'

export type ExecutionLocationControl = {
  placed: boolean
  bound: boolean
}

export function useExecutionLocation(args: { app: AtlasApp; threadId: ThreadId }): ExecutionLocationControl {
  const { app, threadId } = args

  const { placed, bound } = useSessionOwner({ app })

  useEffect(() => {
    void app.sessionOwner.placement.activate({ threadId }).catch(() => undefined)
  }, [app, threadId])

  return { placed, bound }
}
