'use client'

import { chipStatusOf } from '../../data/pod-chip-model'
import { ThreadPodChip } from '../../thread-pod-chip'
import { useThreadPanel } from '../thread-panel-context'
import { DetailsSection, Muted } from './section'

export function PodSection() {
  const { pod, working, details } = useThreadPanel()
  if (chipStatusOf(pod) === null) {
    return (
      <DetailsSection title="Pod">
        <Muted>No pod yet</Muted>
      </DetailsSection>
    )
  }
  return (
    <DetailsSection title="Pod">
      <div className="flex">
        <ThreadPodChip
          pod={pod}
          working={working}
          onResize={details.onResize}
          settingsHref={details.settingsHref}
        />
      </div>
    </DetailsSection>
  )
}
