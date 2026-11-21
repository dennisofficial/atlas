import { EPlanStatus } from '@dltech/atlas-core'
import {
  PodSection,
  type PodMetricsSample,
  type PodSectionProps,
} from '@dltech/atlas-ui/ai/pod-section'
import { EPodState } from '@dltech/atlas-ui/ai/pod-status-chip'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { useEffect, useState } from 'react'

import {
  nextPodSample,
  POD_SAMPLE_MS,
  POD_SECTION_SHAPE,
  POD_SECTION_SHAPES,
  POD_SERIES,
} from '../../../../../../../packages/ui/src/ai/pod-metrics.fixtures'
import { planTaskFixture, populatedPaneValue } from '../__tests__/fixture'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { SessionCrewSection } from './crew-section'
import { SessionGithubSection } from './github-section'
import { SessionDetailsHeader } from './header-section'
import { SectionHead } from './rows'
import { SessionServicesSection } from './services-section'
import { SessionShellsSection } from './shells-section'
import { SessionTodoSection } from './todo-section'

const meta = {
  title: 'Sessions/Details pane with pod',
  parameters: { layout: 'centered' },
}

export default meta

const planFixture = [
  planTaskFixture({ ordinal: 1, text: 'Read the v2 pane brief' }),
  planTaskFixture({
    ordinal: 2,
    text: 'Align the pod section with the pane rows',
    status: EPlanStatus.InProgress,
  }),
  planTaskFixture({
    ordinal: 3,
    text: 'Screenshot the details pane story',
    status: EPlanStatus.Pending,
  }),
]

const paneFixture = (): SessionPaneValue => {
  const value = populatedPaneValue()
  return { ...value, view: { ...value.view, plan: planFixture } }
}

const POD_BASE: PodSectionProps = {
  state: EPodState.Running,
  shape: POD_SECTION_SHAPE,
  shapes: POD_SECTION_SHAPES,
  series: POD_SERIES,
  throttled: false,
  oomKills: 0,
  onStart: () => undefined,
  onStop: () => undefined,
  onResize: () => undefined,
}

function useLivePodSeries({
  series,
  live,
}: {
  series: readonly PodMetricsSample[]
  live: boolean
}): readonly PodMetricsSample[] {
  const [samples, setSamples] = useState(series)
  useEffect(() => {
    if (!live) return undefined
    const timer = setInterval(() => {
      setSamples((previous) => [...previous.slice(1), nextPodSample({ series: previous })])
    }, POD_SAMPLE_MS)
    return () => clearInterval(timer)
  }, [live])
  return samples
}

function DetailsPane({
  value,
  pod,
  live,
  narrow,
}: {
  value: SessionPaneValue
  pod: PodSectionProps
  live?: boolean
  narrow?: boolean
}) {
  const series = useLivePodSeries({ series: pod.series, live: live === true })
  return (
    <div
      className={cn(
        'flex h-[34rem] flex-col overflow-hidden rounded-lg border border-border bg-card',
        narrow === true ? 'w-[24.375rem]' : 'w-[25rem]',
      )}
    >
      <SessionPaneProvider value={value}>
        <div className="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-3">
          <SessionDetailsHeader />
          <section aria-label="Pod" className="flex flex-col">
            <SectionHead title="Pod" />
            <PodSection {...pod} series={series} />
          </section>
          <div data-session-todo-slot className="contents">
            <SessionTodoSection tasks={value.view.plan} />
          </div>
          <SessionGithubSection />
          <SessionServicesSection />
          <SessionCrewSection />
          <SessionShellsSection />
        </div>
      </SessionPaneProvider>
    </div>
  )
}

export const Running = {
  render: () => <DetailsPane value={paneFixture()} pod={POD_BASE} live />,
}

export const Resizing = {
  render: () => (
    <DetailsPane
      value={paneFixture()}
      pod={{ ...POD_BASE, pendingShape: { vcpus: 8, memoryGb: 32 } }}
    />
  ),
}

export const Sleeping = {
  render: () => (
    <DetailsPane value={paneFixture()} pod={{ ...POD_BASE, state: EPodState.Parked }} />
  ),
}

export const Mobile = {
  render: () => <DetailsPane value={paneFixture()} pod={POD_BASE} narrow />,
}
