import type { EExecutionLocation, ThreadId } from '@dltech/atlas-core'
import { useEffect } from 'react'
import { defaultExecutionLocation } from '@dltech/atlas-harness'

import type { AtlasApp } from './compose'
import { useSessionOwner } from './use-session-owner'

export type ExecutionLocationControl = {
  location: EExecutionLocation
  bound: boolean
}

export function useExecutionLocation(args: {
  app: AtlasApp
  threadId: ThreadId
  stored: EExecutionLocation | undefined
}): ExecutionLocationControl {
  const { app, threadId, stored } = args

  const { location, bound } = useSessionOwner({ app })

  useEffect(() => app.executionLocation.subscribe(() => app.files.forget()), [app])

  useEffect(() => {
    const fallback =
      stored ?? defaultExecutionLocation({ settled: app.settings.snapshot().resolution })
    void app.sessionOwner.activateLocal({ threadId, fallback }).catch(() => undefined)
  }, [app, stored, threadId])

  return { location, bound }
}
