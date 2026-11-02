import type { ThreadId } from '@dltech/atlas-core'
import type { AvailabilityControl } from '@dltech/atlas-harness'
import { useEffect, useRef } from 'react'

export type RootWakeControl = Pick<AvailabilityControl, 'bindRootWake'>

export function useAvailabilityRootWake(args: {
  control: RootWakeControl | undefined
  threadId: ThreadId
  onWake: () => void
}): void {
  const { control, threadId } = args
  const wakeRef = useRef(args.onWake)
  wakeRef.current = args.onWake

  useEffect(() => {
    if (control === undefined) return undefined
    return control.bindRootWake(({ threadId: waiting }) => {
      if (waiting === threadId) wakeRef.current()
    })
  }, [control, threadId])
}
