'use client'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import type { PodStatus } from '@dltech/atlas-wire/web'
import { ServerIcon } from 'lucide-react'

import { chipStatusOf, podStateLabelOf } from '../../data/pod-chip-model'
import { ThreadPodChip } from '../../thread-pod-chip'
import { useThreadPanel } from '../thread-panel-context'

const POD_ICON = <ServerIcon aria-hidden className="size-3.5" />

const serveVersionDetailOf = (pod: PodStatus | null) => {
  const version = pod?.resources?.serveVersion
  if (version === undefined) return undefined
  return <span className="font-mono">atlas-serve {version}</span>
}

export function PodSection() {
  const { pod, working, details } = useThreadPanel()
  const detail = serveVersionDetailOf(pod)
  if (chipStatusOf(pod) === null) {
    return (
      <section aria-label="Pod">
        <DetailRow
          label="Pod"
          icon={POD_ICON}
          detail={detail}
          meta={podStateLabelOf(pod) ?? 'No pod yet'}
        />
      </section>
    )
  }
  return (
    <section aria-label="Pod">
      <DetailRow
        label="Pod"
        icon={POD_ICON}
        detail={detail}
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
