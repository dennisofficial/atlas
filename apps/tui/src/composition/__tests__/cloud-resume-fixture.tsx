import { toRunId, toThreadId, type EventDraft } from '@dltech/atlas-core'
import { RemoteTurnRunner, ETurnStatus } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import React, { act, useRef, useState } from 'react'

import { SHIPPED_THINKING } from '../../store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { fakeCloudChannel } from '../cloud/__tests__/fixture'
import type { DirectoryMove } from '../directory-move'
import { EThreadRows, useThreadView } from '../use-thread-view'
import { useTurnDriver, type TurnDriver } from '../use-turn-driver'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

export const RESUME_THREAD = toThreadId('cloud-resume-owner')

export type ResumeProbe = { driver: TurnDriver | null; failure: string | null }

function ResumeProbeView(props: { app: FakeApp; probe: ResumeProbe }): React.ReactNode {
  const started = useRef(true)
  const pendingMove = useRef<DirectoryMove | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const view = useThreadView({
    app: props.app,
    threadId: RESUME_THREAD,
    rows: EThreadRows.Own,
    thinking: SHIPPED_THINKING,
    readClock: () => 0,
  })
  const driver = useTurnDriver({
    app: props.app,
    threadId: RESUME_THREAD,
    started,
    pendingMove,
    view,
    readClock: () => 0,
    onSettled: async () => undefined,
    onUndone: () => undefined,
    setFailure,
    forgetUsage: () => undefined,
    cancelCompaction: () => false,
  })
  props.probe.driver = driver
  props.probe.failure = failure
  return <text>{failure ?? (driver.working ? 'working' : 'idle')}</text>
}

export async function mountCloudResume(
  args: { inFlightBeforeMount?: boolean; holdTurn?: boolean } = {},
) {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
  })
  await app.log.append({
    threadId: RESUME_THREAD,
    runId: toRunId('interrupted-run'),
    drafts: [
      { type: 'user-said', text: 'finish the work' },
      {
        type: 'assistant-said',
        parts: [{ type: 'text', text: 'I was checking' }],
        interrupted: true,
      },
    ],
  })
  const original = await app.log.read({ threadId: RESUME_THREAD })
  const writes: EventDraft[][] = []
  app.log.append = async ({ drafts }) => {
    writes.push([...drafts])
    throw new Error('the sandbox owns the transcript while lifted — reads only over the channel')
  }
  const channel = fakeCloudChannel({ threadId: RESUME_THREAD })
  if (args.inFlightBeforeMount === true) {
    channel.snapshot = () => [{ type: 'turn-working', working: true }]
  }
  const runs: ({ resume?: boolean } | undefined)[] = []
  channel.run = (runArgs?: { resume?: boolean }) => {
    runs.push(runArgs)
    if (args.holdTurn === true) return
    queueMicrotask(() =>
      channel.endTurn({
        status: ETurnStatus.Completed,
        runId: toRunId('resumed-run'),
      }),
    )
  }
  Object.assign(app, {
    channel,
    runner: new RemoteTurnRunner({ channel, wake: async () => undefined }),
  })
  const probe: ResumeProbe = { driver: null, failure: null }
  const setup = await testRender(<ResumeProbeView app={app} probe={probe} />, {
    width: 80,
    height: 8,
  })
  await setup.flush()
  return {
    app,
    channel,
    probe,
    runs,
    writes,
    original,
    async perform(handle: () => void) {
      await act(async () => {
        const drivenBefore = runs.length
        handle()
        if (probe.driver !== null && runs.length > drivenBefore) await probe.driver.whenSettled()
      })
      await setup.flush()
    },
    flush: () => setup.flush(),
    done: () => teardown(setup),
    driver: (): TurnDriver => {
      if (probe.driver === null) throw new Error('the resume probe never mounted')
      return probe.driver
    },
  }
}
