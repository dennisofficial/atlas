'use client'

import { podBusyFactsOf, podBusyOf } from '@dltech/atlas-core'
import { PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'
import {
  EVercelPlan,
  sandboxSizesOfPlan,
  vercelPlanCapNote,
  type PodStatus,
} from '@dltech/atlas-wire/web'

import {
  ResizeBusyDialog,
  useResizeConfirmation,
  type ResizeRequest,
} from '@/features/pods/pod-resize-confirmation'
import { useVercelPlan } from '@/features/settings/data/user/use-vercel-plan'

import { chipStatusOf } from './data/pod-chip-model'

export type ThreadPodChipProps = {
  pod: PodStatus | null
  working: boolean
  onResize: (request: ResizeRequest) => Promise<void>
  settingsHref?: string | undefined
  plan?: EVercelPlan | undefined
}

export function ThreadPodChip({ pod, working, onResize, settingsHref, plan }: ThreadPodChipProps) {
  const busy = podBusyOf({
    ...podBusyFactsOf({ state: undefined, shellsRunning: 0, servicesRunning: 0 }),
    turnInFlight: working,
  })
  const { confirmation, handleResize } = useResizeConfirmation({
    busy,
    onResize,
    canWait: false,
  })
  const effective = plan ?? EVercelPlan.Unknown
  const status = chipStatusOf(pod)
  if (status === null) return null

  return (
    <>
      <PodStatusChip
        status={status}
        sizes={sandboxSizesOfPlan(effective)}
        onResize={handleResize}
        planCapHint={vercelPlanCapNote(effective)}
        settingsHref={settingsHref}
      />
      <ResizeBusyDialog confirmation={confirmation} />
    </>
  )
}

export function LiveThreadPodChip(props: Omit<ThreadPodChipProps, 'plan'>) {
  return <ThreadPodChip {...props} plan={useVercelPlan()} />
}
