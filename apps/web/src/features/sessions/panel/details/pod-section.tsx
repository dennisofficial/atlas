'use client'

import { podBusyFactsOf, podBusyOf, type PodBusy } from '@dltech/atlas-core'
import {
  EPodAction,
  PodSection,
  type PodShape,
  type PodSectionProps,
  type UnavailablePodShape,
} from '@dltech/atlas-ui/ai/pod-section'
import { EPodState } from '@dltech/atlas-ui/ai/pod-status-chip'
import type { SessionStatusOutput } from '@dltech/atlas-protocol'

import {
  POD_RESTART_BODY,
  ResizeBusyDialog,
  useShapeResizeConfirmation,
} from '@/features/pods/pod-resize-confirmation'

import { podChipStatusOf } from '../../data/pod-chip-status'
import type { PodMetricsSample } from '../../data/pod-metrics-series'
import { resizePod } from '../../data/pod-resources'
import { sessionsApi } from '../../data/sessions-api'
import { usePodMetrics } from '../../data/use-pod-metrics'
import { usePodPower, type PodDeclaredState, type PodPower } from '../../data/use-pod-power'
import type { SessionViewModel } from '../../data/session-view-model'
import { useSessionPaneValue } from '../pane-value'
import { SectionHead } from './rows'

export const podBusyOfView = (view: SessionViewModel, state: string | undefined): PodBusy =>
  podBusyOf(
    podBusyFactsOf({
      state: state as never,
      shellsRunning: view.shells.running,
      servicesRunning: view.previews.length,
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
  pendingShape?: PodShape
  resizeError?: string
}

export const podSectionViewOf = (args: {
  pod: SessionStatusOutput['pod']
  live: boolean
  sandbox?: SessionStatusOutput['sandbox']
}): PodSectionView | null => {
  const { pod, live, sandbox } = args
  const status = podChipStatusOf({ pod, live, sandbox })
  if (status === null) return null
  const offered = pod?.sizing?.offered ?? [DEFAULT_POD_SHAPE]
  const shape = podShapeOfView(pod) ?? pod?.desiredShape ?? offered[0] ?? DEFAULT_POD_SHAPE
  const pendingShape =
    pod?.phase === 'steady' || pod?.desiredShape === undefined ? undefined : pod.desiredShape
  return {
    state: status.state,
    shape,
    shapes: offered,
    unavailable: pod?.sizing?.unavailable ?? [],
    ...(pendingShape === undefined ? {} : { pendingShape }),
    ...(pod?.error === undefined ? {} : { resizeError: pod.error }),
  }
}

export type PodPaneSectionProps = PodSectionView & {
  series: readonly PodMetricsSample[]
  power: PodPower
  onStart: () => void
  onStop: () => void
  onConfirm: () => void
  onCancel: () => void
  onResize: (shape: PodShape) => void
}

const sectionOf = (props: PodPaneSectionProps): PodSectionProps => ({
  state: props.state,
  shape: props.shape,
  shapes: props.shapes,
  unavailable: props.unavailable,
  pendingShape: props.pendingShape,
  resizeError: props.resizeError,
  series: props.series,
  throttled: props.series.at(-1)?.throttled,
  oomKills: props.series.at(-1)?.oomKills,
  stopping: props.power.state.phase === 'sleeping',
  confirmAction: props.power.state.phase === 'confirm' ? EPodAction.Stop : undefined,
  onStart: props.onStart,
  onStop: props.onStop,
  onResize: props.onResize,
  onConfirm: props.onConfirm,
  onCancel: props.onCancel,
})

export function PodPaneSection(props: PodPaneSectionProps) {
  return (
    <section data-session-pod aria-label="Pod" className="flex flex-col">
      <SectionHead title="Pod" />
      <PodSection {...sectionOf(props)} />
    </section>
  )
}

export function SessionPodSection() {
  const { sessionId, view, status } = useSessionPaneValue()
  const section = podSectionViewOf({
    pod: status?.pod,
    live: status?.lease.live ?? false,
    sandbox: status?.sandbox,
  })
  const power = usePodPower({ sessionId, declared: declaredPodStateOf(section?.state) })
  const running = section?.state === EPodState.Running
  const series = usePodMetrics({ sessionId, enabled: running })
  const { confirmation, handleResize } = useShapeResizeConfirmation({
    busy: podBusyOfView(view, status?.state),
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
  if (section === null) return null
  return (
    <>
      <PodPaneSection
        {...section}
        series={series}
        power={power}
        onStart={power.wake}
        onStop={power.sleep}
        onConfirm={power.forceSleep}
        onCancel={power.cancel}
        onResize={handleResize}
      />
      <ResizeBusyDialog confirmation={confirmation} body={POD_RESTART_BODY} />
    </>
  )
}
