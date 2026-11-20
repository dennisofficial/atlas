'use client'

import { podBusyFactsOf, podBusyOf, type PodBusy } from '@dltech/atlas-core'
import { PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'
import { Badge } from '@dltech/atlas-ui/components/badge'
import {
  ECredentialSource,
  ESandboxProvider,
  type SessionStatusOutput,
} from '@dltech/atlas-protocol'
import { type EVercelPlan, sandboxSizesOfPlan, vercelPlanCapNote } from '@dltech/atlas-wire/web'

import { hrefOfPage, ESettingsPage } from '@/features/settings/settings-nav'
import { sandboxSettingsHrefOf } from '@/features/threads/data/header-model'
import { useVercelPlan } from '@/features/settings/data/user/use-vercel-plan'
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

/** The sizes a pod on Atlas credentials or Agent37 runs at — its own cap, not the Vercel plan's. */
export const PLATFORM_POD_SIZES: readonly number[] = [2, 4, 8]

export type PodSizes = { sizes: readonly number[]; planCapHint: string | undefined }

/** Only a Vercel pod on the team's own credentials is limited by that team's plan. */
export const podSizesOf = (args: {
  sandboxProvider: string | undefined
  credentialSource: string | undefined
  plan: EVercelPlan
}): PodSizes => {
  const vercelByok =
    args.sandboxProvider !== ESandboxProvider.Agent37 &&
    args.credentialSource !== ECredentialSource.Platform
  return vercelByok
    ? { sizes: sandboxSizesOfPlan(args.plan), planCapHint: vercelPlanCapNote(args.plan) }
    : { sizes: PLATFORM_POD_SIZES, planCapHint: undefined }
}

const settingsHrefOf = (projectId: string | undefined): string =>
  sandboxSettingsHrefOf({ projectId: projectId ?? null }) ??
  hrefOfPage(ESettingsPage.UsageSandboxes)

export type PodStatusSectionProps = {
  pod: SessionStatusOutput['pod']
  live: boolean
  busy: PodBusy
  plan: EVercelPlan
  sandboxProvider?: string | undefined
  credentialSource?: string | undefined
  settingsHref: string
  onResize: (request: ResizeRequest) => Promise<void>
}

export const sandboxProviderLabelOf = (provider: string): string =>
  provider === ESandboxProvider.Agent37 ? 'Agent37' : 'Vercel'

export function PodStatusSection(props: PodStatusSectionProps) {
  const { pod, live, busy, plan, sandboxProvider, credentialSource, settingsHref, onResize } = props
  const { confirmation, handleResize } = useResizeConfirmation({ busy, onResize })
  const status = podChipStatusOf({ pod, live })
  if (status === null) return null
  const { sizes, planCapHint } = podSizesOf({ sandboxProvider, credentialSource, plan })
  return (
    <section data-session-pod aria-label="Pod" className="flex items-center gap-2">
      <PodStatusChip
        status={status}
        sizes={sizes}
        onResize={handleResize}
        planCapHint={planCapHint}
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
  const plan = useVercelPlan()

  const handleResize = async (request: ResizeRequest) => {
    await resizePod({ api: sessionsApi, sessionId, ...request })
  }

  return (
    <PodStatusSection
      pod={status?.pod}
      live={status?.lease.live ?? false}
      busy={podBusyOfView(view, status?.state)}
      plan={plan}
      sandboxProvider={status?.sandboxProvider}
      credentialSource={status?.credentialSource}
      settingsHref={settingsHrefOf(projectId)}
      onResize={handleResize}
    />
  )
}
