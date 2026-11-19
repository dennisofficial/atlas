'use client'

import { PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'
import type { SessionStatusOutput } from '@dltech/atlas-protocol'
import { type EVercelPlan, sandboxSizesOfPlan, vercelPlanCapNote } from '@dltech/atlas-wire/web'

import { hrefOfPage, ESettingsPage } from '@/features/settings/settings-nav'
import { sandboxSettingsHrefOf } from '@/features/threads/data/header-model'
import { useVercelPlan } from '@/features/settings/data/user/use-vercel-plan'
import {
  POD_RESTART_BODY,
  RestartConfirmDialog,
  useResizeConfirmation,
} from '@/features/pods/pod-resize-confirmation'

import { podChipStatusOf } from '../../data/pod-chip-status'
import { resizePod } from '../../data/pod-resources'
import { sessionsApi } from '../../data/sessions-api'
import type { SessionViewModel } from '../../data/session-view-model'
import { useSessionPaneValue } from '../pane-value'

export const podBusyOf = (view: SessionViewModel): boolean =>
  view.shells.running > 0 || view.previews.length > 0

const settingsHrefOf = (projectId: string | undefined): string =>
  sandboxSettingsHrefOf({ projectId: projectId ?? null }) ??
  hrefOfPage(ESettingsPage.UsageSandboxes)

export type PodStatusSectionProps = {
  pod: SessionStatusOutput['pod']
  live: boolean
  busy: boolean
  plan: EVercelPlan
  settingsHref: string
  onResize: (vcpus: number) => Promise<void>
}

export function PodStatusSection(props: PodStatusSectionProps) {
  const { pod, live, busy, plan, settingsHref, onResize } = props
  const { confirmation, handleResize } = useResizeConfirmation({ busy, onResize })
  const status = podChipStatusOf({ pod, live })
  if (status === null) return null
  return (
    <section data-session-pod aria-label="Pod" className="flex items-center">
      <PodStatusChip
        status={status}
        sizes={sandboxSizesOfPlan(plan)}
        onResize={handleResize}
        planCapHint={vercelPlanCapNote(plan)}
        settingsHref={settingsHref}
      />
      <RestartConfirmDialog confirmation={confirmation} body={POD_RESTART_BODY} />
    </section>
  )
}

export function SessionPodSection() {
  const { sessionId, view, status, projectId } = useSessionPaneValue()
  const plan = useVercelPlan()

  const handleResize = async (vcpus: number) => {
    await resizePod({ api: sessionsApi, sessionId, vcpus })
  }

  return (
    <PodStatusSection
      pod={status?.pod}
      live={status?.lease.live ?? false}
      busy={podBusyOf(view)}
      plan={plan}
      settingsHref={settingsHrefOf(projectId)}
      onResize={handleResize}
    />
  )
}
