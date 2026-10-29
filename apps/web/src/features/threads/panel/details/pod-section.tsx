'use client'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import { ServerIcon } from 'lucide-react'

import { chipStatusOf } from '../../data/pod-chip-model'
import { ThreadPodChip } from '../../thread-pod-chip'
import { useThreadPanel } from '../thread-panel-context'

const POD_ICON = <ServerIcon aria-hidden className="size-3.5" />

export function PodSection() {
  const { pod, working, details } = useThreadPanel()
  if (chipStatusOf(pod) === null) {
    return (
      <section aria-label="Pod">
        <DetailRow label="Pod" icon={POD_ICON} meta="No pod yet" />
      </section>
    )
  }
  return (
    <section aria-label="Pod">
      <DetailRow
        label="Pod"
        icon={POD_ICON}
        actions={
          <ThreadPodChip
            pod={pod}
            working={working}
            onResize={details.onResize}
            settingsHref={details.settingsHref}
          />
        }
      />
    </section>
  )
}
