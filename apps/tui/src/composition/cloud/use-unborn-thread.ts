import { useEffect, useRef } from 'react'

import { EHarnessPlacement, type ThreadId } from '@dltech/atlas-core'

import type { AtlasApp } from '../compose'
import type { SendArgs } from '../conversation-types'
import type { OpenedConversation } from '../open-conversation'
import { preferredRunner } from './born-cloud'
import { bornPlacementChip } from './born-placement-chip'

export const unplacedThread = (args: { opened: OpenedConversation; started: boolean }): boolean =>
  !args.started &&
  args.opened.bootCloudThreadId === undefined &&
  args.opened.executionLocation === undefined

export function preferenceChipFor(args: { app: AtlasApp; threadId: ThreadId }): void {
  bornPlacementChip(args.app).set({
    threadId: args.threadId,
    harness: EHarnessPlacement.Cloud,
    runner: preferredRunner(args.app),
    provisioning: false,
    preference: true,
  })
}

export function useUnbornThread(args: {
  app: AtlasApp
  threadId: ThreadId
  unplaced: boolean
  attached: boolean
  onArrival: (send: SendArgs) => void
}): void {
  const latest = useRef(args)
  latest.current = args
  const { app, threadId, unplaced, attached } = args

  useEffect(() => {
    if (!unplaced || attached) return
    if (bornPlacementChip(app).snapshot()?.threadId === threadId) return
    preferenceChipFor({ app, threadId })
  }, [app, threadId, unplaced, attached])

  useEffect(() => {
    if (!attached) return undefined
    const chip = bornPlacementChip(app)
    const handleArrival = (): void => {
      const held = chip.snapshot()
      if (
        held === null ||
        held.threadId !== threadId ||
        held.provisioning ||
        held.arrival === undefined
      )
        return
      chip.set({ ...held, arrival: undefined })
      latest.current.onArrival(held.arrival)
    }
    handleArrival()
    return chip.subscribe(handleArrival)
  }, [app, threadId, attached])
}
