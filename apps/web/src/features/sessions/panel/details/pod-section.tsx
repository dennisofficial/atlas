'use client'

import { useEffect, useState } from 'react'

import { podBusyFactsOf, podResizeBusyOf, type PodBusy } from '@dltech/atlas-core'
import {
  EPodAction,
  PodSection,
  type PodShape,
  type PodSectionProps,
  type UnavailablePodShape,
} from '@dltech/atlas-ui/ai/pod-section'
import { EPodState } from '@dltech/atlas-ui/ai/pod-status-chip'
import { ESandboxProvider, type SessionStatusOutput } from '@dltech/atlas-protocol'

import {
  POD_RESTART_BODY,
  ResizeBusyDialog,
  useDiskResizeConfirmation,
  useShapeResizeConfirmation,
} from '@/features/pods/pod-resize-confirmation'

import { podChipStatusOf } from '../../data/pod-chip-status'
import type { PodMetricsSample } from '../../data/pod-metrics-series'
import { cancelPodResize, resizePod } from '../../data/pod-resources'
import { sessionsApi } from '../../data/sessions-api'
import { usePodMetrics } from '../../data/use-pod-metrics'
import { usePodPower, type PodDeclaredState, type PodPower } from '../../data/use-pod-power'
import type { SessionViewModel } from '../../data/session-view-model'
import { useSessionPaneValue } from '../pane-value'
import { SectionHead } from './rows'

export const podBusyOfView = (args: {
  view: SessionViewModel
  status: { state: SessionStatusOutput['state']; setupRunning?: boolean | undefined } | undefined
}): PodBusy =>
  podResizeBusyOf(
    podBusyFactsOf({
      state: args.status?.state,
      setupRunning: args.status?.setupRunning === true,
      shellsRunning: args.view.shells.running,
      servicesRunning: args.view.previews.length,
      agentsRunning: args.view.crew.running,
    }),
  )

export const declaredPodStateOf = (state: EPodState | undefined): PodDeclaredState => {
  if (state === EPodState.Running) return 'running'
  if (state === EPodState.Parked || state === EPodState.Stopped) return 'sleeping'
  return undefined
}

/** The size a session pod runs at until it reports its own. */
export const DEFAULT_POD_SHAPE: PodShape = { vcpus: 2, memoryGb: 4 }

const podShapeOfView = (pod: SessionStatusOutput['pod']): PodShape | undefined => {
  const actual = pod?.shape
  if (actual === undefined) return undefined
  if (actual.memoryGb !== null) return { vcpus: actual.vcpus, memoryGb: actual.memoryGb }
  const desired = pod?.desiredShape
  if (desired !== undefined && desired.vcpus === actual.vcpus) return desired
  return (pod?.sizing?.offered ?? []).find((offered) => offered.vcpus === actual.vcpus)
}

export type PodSectionView = {
  state: EPodState
  shape: PodShape
  shapes: readonly PodShape[]
  unavailable: readonly UnavailablePodShape[]
  agent37: boolean
  diskGb?: number
  pendingShape?: PodShape
  resizeWaiting?: true
  resizeError?: string
}

export const podSectionViewOf = (args: {
  pod: SessionStatusOutput['pod']
  live: boolean
  sandbox?: SessionStatusOutput['sandbox']
  sandboxProvider?: SessionStatusOutput['sandboxProvider']
}): PodSectionView => {
  const { pod, live, sandbox, sandboxProvider } = args
  const status = podChipStatusOf({ pod: pod ?? { phase: 'steady' }, live, sandbox })
  const state = status?.state ?? (live ? EPodState.Running : EPodState.Parked)
  const offered = pod?.sizing?.offered ?? [DEFAULT_POD_SHAPE]
  const shape = podShapeOfView(pod) ?? pod?.desiredShape ?? offered[0] ?? DEFAULT_POD_SHAPE
  const pendingShape =
    pod?.phase === 'steady' || pod?.desiredShape === undefined ? undefined : pod.desiredShape
  return {
    state,
    shape,
    shapes: offered,
    unavailable: pod?.sizing?.unavailable ?? [],
    agent37: sandboxProvider === ESandboxProvider.Agent37,
    ...(pod?.diskGb === undefined ? {} : { diskGb: pod.diskGb }),
    ...(pendingShape === undefined ? {} : { pendingShape }),
    ...(pod?.phase === 'waiting' ? { resizeWaiting: true as const } : {}),
    ...(pod?.error === undefined ? {} : { resizeError: pod.error }),
  }
}

export type PodPaneSectionProps = PodSectionView & {
  series: readonly PodMetricsSample[]
  usageUnavailable?: boolean | undefined
  power: PodPower
  sizeMenuOpen?: boolean | undefined
  onSizeMenuOpenChange?: ((open: boolean) => void) | undefined
  onStart: () => void
  onStop: () => void
  onConfirm: () => void
  onCancel: () => void
  onResize: (shape: PodShape) => void
  onResizeNow: () => Promise<void>
  onCancelResize: () => Promise<void>
  onGrowDisk: (diskGb: number) => void
}

const sectionOf = (props: PodPaneSectionProps): PodSectionProps => {
  const latest = props.series.at(-1)
  return {
    state: props.state,
    shape: props.shape,
    shapes: props.shapes,
    unavailable: props.unavailable,
    pendingShape: props.pendingShape,
    resizeWaiting: props.resizeWaiting === true,
    resizeError: props.resizeError,
    series: props.series,
    usageUnavailable: props.usageUnavailable,
    throttled: latest?.throttled,
    oomKills: latest?.oomKills,
    oomEvents: latest?.oomEvents,
    commandRamLimitGb: latest?.commandRamLimitGb,
    diskLimitGb: props.diskGb,
    sizeMenuOpen: props.sizeMenuOpen,
    onSizeMenuOpenChange: props.onSizeMenuOpenChange,
    stopping: props.power.state.phase === 'sleeping',
    confirmAction: props.power.state.phase === 'confirm' ? EPodAction.Stop : undefined,
    onStart: props.onStart,
    onStop: props.onStop,
    onResize: props.onResize,
    onResizeNow: props.onResizeNow,
    onCancelResize: props.onCancelResize,
    diskGrow: props.agent37,
    onGrowDisk: props.onGrowDisk,
    onConfirm: props.onConfirm,
    onCancel: props.onCancel,
  }
}

export function PodPaneSection(props: PodPaneSectionProps) {
  return (
    <section data-session-pod aria-label="Pod" className="flex flex-col">
      <SectionHead title="Pod" />
      <PodSection {...sectionOf(props)} />
    </section>
  )
}

export function SessionPodSection() {
  const { sessionId, view, status, podSizeRequest, consumePodSizeRequest } = useSessionPaneValue()
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false)
  const handleSizeMenuOpenChange = (open: boolean) => setSizeMenuOpen(open)
  useEffect(() => {
    if (podSizeRequest === 0) return
    consumePodSizeRequest()
    document.querySelector('[data-session-pod]')?.scrollIntoView({ block: 'nearest' })
    setSizeMenuOpen(true)
  }, [podSizeRequest, consumePodSizeRequest])
  const section = podSectionViewOf({
    pod: status?.pod,
    live: status?.lease.live ?? false,
    sandbox: status?.sandbox,
    sandboxProvider: status?.sandboxProvider,
  })
  const power = usePodPower({ sessionId, declared: declaredPodStateOf(section.state) })
  const running = section.state === EPodState.Running
  const metrics = usePodMetrics({ sessionId, enabled: running })
  const busy = podBusyOfView({ view, status })
  const { confirmation, handleResize } = useShapeResizeConfirmation({
    busy,
    onResize: async (request) => {
      await resizePod({
        api: sessionsApi,
        sessionId,
        vcpus: request.shape.vcpus,
        memoryGb: request.shape.memoryGb,
        whenIdle: request.whenIdle,
      })
    },
  })
  const disk = useDiskResizeConfirmation({
    busy,
    onResize: async (request) => {
      await resizePod({
        api: sessionsApi,
        sessionId,
        vcpus: section.shape.vcpus,
        memoryGb: section.shape.memoryGb,
        diskGb: request.diskGb,
        whenIdle: request.whenIdle,
      })
    },
  })
  const handleResizeNow = async () => {
    const shape = section.pendingShape
    if (shape === undefined) return
    await resizePod({
      api: sessionsApi,
      sessionId,
      vcpus: shape.vcpus,
      memoryGb: shape.memoryGb,
      whenIdle: false,
    })
  }
  const handleCancelResize = async () => {
    await cancelPodResize({ api: sessionsApi, sessionId })
  }
  return (
    <>
      <PodPaneSection
        {...section}
        series={metrics.series}
        usageUnavailable={metrics.unavailable}
        power={power}
        sizeMenuOpen={sizeMenuOpen}
        onSizeMenuOpenChange={handleSizeMenuOpenChange}
        onStart={power.wake}
        onStop={power.sleep}
        onConfirm={power.forceSleep}
        onCancel={power.cancel}
        onResize={handleResize}
        onResizeNow={handleResizeNow}
        onCancelResize={handleCancelResize}
        onGrowDisk={disk.handleGrow}
      />
      <ResizeBusyDialog confirmation={confirmation} body={POD_RESTART_BODY} />
      <ResizeBusyDialog confirmation={disk.confirmation} />
    </>
  )
}
