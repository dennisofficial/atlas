'use client'

import { PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'
import {
  EVercelPlan,
  sandboxSizesOfPlan,
  vercelPlanCapNote,
  type PodStatus,
} from '@dltech/atlas-wire/web'

import {
  RestartConfirmDialog,
  useResizeConfirmation,
} from '@/features/pods/pod-resize-confirmation'
import { useVercelPlan } from '@/features/settings/data/user/use-vercel-plan'

import { chipStatusOf } from './data/pod-chip-model'

export type ThreadPodChipProps = {
  pod: PodStatus | null
  working: boolean
  onResize: (vcpus: number) => Promise<void>
  settingsHref?: string | undefined
  plan?: EVercelPlan | undefined
}

export function ThreadPodChip({ pod, working, onResize, settingsHref, plan }: ThreadPodChipProps) {
  const { confirmation, handleResize } = useResizeConfirmation({ busy: working, onResize })
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
      <RestartConfirmDialog confirmation={confirmation} />
    </>
  )
}

export function LiveThreadPodChip(props: Omit<ThreadPodChipProps, 'plan'>) {
  return <ThreadPodChip {...props} plan={useVercelPlan()} />
}
