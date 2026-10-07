import {
  EQualityReviewStatus,
  toCallId,
  toThreadId,
  type CodeQualityReviewedBody,
  type ThreadId,
} from '@dltech/atlas-core'
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import React, { act, useState } from 'react'

import { settingsModel, type SettingsState } from '../../ui/settings-model'
import type { AtlasApp } from '../compose'
import { useQualityHealth, type QualityHealthRead } from '../use-quality-health'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

export const appWith = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })

globalThis.IS_REACT_ACT_ENVIRONMENT = true

export const THREAD = toThreadId('quality-thread')

const QUALITY_PAGE_INDEX = 5

type Probe = { current: QualityHealthRead | undefined }

type Drive = { state: SettingsState | null; threadId: ThreadId }

function Harness(args: { probe: Probe; app: FakeApp; state: SettingsState | null; threadId: ThreadId }) {
  args.probe.current = useQualityHealth({
    app: args.app as unknown as AtlasApp,
    state: args.state,
    model: settingsModel({
      definitions: args.app.settings.definitions,
      resolution: args.app.settings.snapshot().resolution,
    }),
    threadId: args.threadId,
  })
  return <box />
}

export type Mounted = {
  setup: TestRendererSetup
  root: Root
  probe: Probe
  drive: (next: Partial<Drive>) => void
  current: () => Drive
}

const live: Mounted[] = []


export async function unmountAll(): Promise<void> {
  const held = live.splice(0)
  for (const entry of held) {
    await act(async () => entry.root.unmount())
    entry.setup.renderer.destroy()
  }
}

export async function mount(args: {
  app: FakeApp
  state: SettingsState | null
  threadId?: ThreadId
}): Promise<Mounted> {
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  const probe: Probe = { current: undefined }
  const initial: Drive = { state: args.state, threadId: args.threadId ?? THREAD }

  let setDrive: (update: (current: Drive) => Drive) => void = () => undefined
  let snapshot: Drive = initial

  function Wrapper(): React.ReactNode {
    const [drive, update] = useState<Drive>(initial)
    setDrive = update
    snapshot = drive
    return (
      <Harness probe={probe} app={args.app} state={drive.state} threadId={drive.threadId} />
    )
  }

  await act(async () => {
    root.render(<Wrapper />)
    await setup.flush()
  })

  const mounted: Mounted = {
    setup,
    root,
    probe,
    drive: (next) => setDrive((current) => ({ ...current, ...next })),
    current: () => snapshot,
  }
  live.push(mounted)
  return mounted
}

export async function rerender(mounted: Mounted, args: Partial<Drive>): Promise<void> {
  await act(async () => {
    mounted.drive(args)
    await mounted.setup.flush()
  })
}

export const ON_QUALITY: SettingsState = { pageIndex: QUALITY_PAGE_INDEX, rowIndex: 0 }

export async function appendReview(app: FakeApp, threadId: ThreadId): Promise<void> {
  const publisher = app.channel.publisherFor({ threadId })
  await app.log.append({
    threadId,
    runId: app.ids.nextRunId(),
    drafts: [reviewDraft()],
  })
  publisher.eventsAppended()
}

export const settleReads = async (mounted: Mounted): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await mounted.setup.flush()
  })
}

export const latest = (mounted: Mounted): QualityHealthRead | undefined => mounted.probe.current

export const reviewDraft = (): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: toCallId('call-1'),
  workspaceNamespace: 'local:abc',
  path: 'src/a.ts',
  beforeHash: 'b1',
  afterHash: 'a1',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 12,
})
