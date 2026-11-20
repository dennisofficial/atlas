'use client'

import { podBusyFactsOf, podBusyOf, type PodBusy } from '@dltech/atlas-core'
import { PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { ESandboxProvider, type SessionStatusOutput } from '@dltech/atlas-protocol'

import { hrefOfPage, ESettingsPage } from '@/features/settings/settings-nav'
import { sandboxSettingsHrefOf } from '@/features/threads/data/header-model'
import {
  POD_RESTART_BODY,
  ResizeBusyDialog,
  useResizeConfirmation,
  type ResizeRequest,
} from '@/features/pods/pod-resize-confirmation'

import { podChipStatusOf } from '../../data/pod-chip-status'
import { resizePod } from '../../data/pod-resources'
import { sessionsApi } from '../../data/sessions-api'
import type { SessionViewModel } from '../../data/session-view-model'
import { useSessionPaneValue } from '../pane-value'

export const podBusyOfView = (view: SessionViewModel, state: string | undefined): PodBusy =>
  podBusyOf(
    podBusyFactsOf({
      state: state as never,
      shellsRunning: view.shells.running,
      servicesRunning: view.previews.length,
    }),
  )

/** The sizes a pod on the platform's own credentials runs at — its own cap, not a Vercel plan's. */
export const PLATFORM_POD_SIZES: readonly number[] = [2, 4, 8]

const settingsHrefOf = (projectId: string | undefined): string =>
  sandboxSettingsHrefOf({ projectId: projectId ?? null }) ??
  hrefOfPage(ESettingsPage.UsageSandboxes)

export type PodStatusSectionProps = {
  pod: SessionStatusOutput['pod']
  live: boolean
  busy: PodBusy
  sandboxProvider?: string | undefined
  settingsHref: string
  onResize: (request: ResizeRequest) => Promise<void>
}

export const sandboxProviderLabelOf = (provider: string): string =>
  provider === ESandboxProvider.Agent37 ? 'Agent37' : 'Vercel'

export function PodStatusSection(props: PodStatusSectionProps) {
  const { pod, live, busy, sandboxProvider, settingsHref, onResize } = props
  const { confirmation, handleResize } = useResizeConfirmation({ busy, onResize })
  const status = podChipStatusOf({ pod, live })
  if (status === null) return null
  return (
    <section data-session-pod aria-label="Pod" className="flex items-center gap-2">
      <PodStatusChip
        status={status}
        sizes={PLATFORM_POD_SIZES}
        onResize={handleResize}
        settingsHref={settingsHref}
      />
      {sandboxProvider === undefined ? null : (
        <Badge variant="outline" data-sandbox-provider={sandboxProvider}>
          {sandboxProviderLabelOf(sandboxProvider)}
        </Badge>
      )}
      <ResizeBusyDialog confirmation={confirmation} body={POD_RESTART_BODY} />
    </section>
  )
}

export function SessionPodSection() {
  const { sessionId, view, status, projectId } = useSessionPaneValue()

  const handleResize = async (request: ResizeRequest) => {
    await resizePod({ api: sessionsApi, sessionId, ...request })
  }

  return (
    <PodStatusSection
      pod={status?.pod}
      live={status?.lease.live ?? false}
      busy={podBusyOfView(view, status?.state)}
      sandboxProvider={status?.sandboxProvider}
      settingsHref={settingsHrefOf(projectId)}
      onResize={handleResize}
    />
  )
}
