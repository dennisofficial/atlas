'use client'

import { podBusyFactsOf, podBusyOf } from '@dltech/atlas-core'
import { PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'
import { SANDBOX_VCPU_SIZES, type PodStatus } from '@dltech/atlas-wire/web'

import {
  ResizeBusyDialog,
  useResizeConfirmation,
  type ResizeRequest,
} from '@/features/pods/pod-resize-confirmation'

import { chipStatusOf } from './data/pod-chip-model'

export type ThreadPodChipProps = {
  pod: PodStatus | null
  working: boolean
  onResize: (request: ResizeRequest) => Promise<void>
  settingsHref?: string | undefined
}

export function ThreadPodChip({ pod, working, onResize, settingsHref }: ThreadPodChipProps) {
  const busy = podBusyOf({
    ...podBusyFactsOf({ state: undefined, shellsRunning: 0, servicesRunning: 0 }),
    turnInFlight: working,
  })
  const { confirmation, handleResize } = useResizeConfirmation({
    busy,
    onResize,
    canWait: false,
  })
  const status = chipStatusOf(pod)
  if (status === null) return null

  return (
    <>
      <PodStatusChip
        status={status}
        sizes={SANDBOX_VCPU_SIZES}
        onResize={handleResize}
        settingsHref={settingsHref}
      />
      <ResizeBusyDialog confirmation={confirmation} />
    </>
  )
}
