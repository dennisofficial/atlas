import { describe, expect, it } from 'bun:test'
import { toRunId, type Event } from '@dltech/atlas-core'
import { ETurnStatus } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import React, { act, useRef, useState } from 'react'

import { SHIPPED_THINKING } from '../../store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { EOpenMode } from '../config'
import type { DirectoryMove } from '../directory-move'
import { useResumeOnOpen } from '../use-conversation-resume'
import { EThreadRows, useThreadView } from '../use-thread-view'
import { useTurnDriver, type TurnDriver } from '../use-turn-driver'
import type { FakeApp } from './fake-app'
import { mountCloudResume, RESUME_THREAD } from './cloud-resume-fixture'

type RemountProbe = { driver: TurnDriver | null; failure: string | null }

function RemountedView(props: {
  app: FakeApp
  probe: RemountProbe
  events: readonly Event[]
}): React.ReactNode {
  const started = useRef(true)
  const pendingMove = useRef<DirectoryMove | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const view = useThreadView({
    app: props.app,
    threadId: RESUME_THREAD,
    rows: EThreadRows.Own,
    thinking: SHIPPED_THINKING,
    readClock: () => 0,
    initial: () => ({ events: props.events }),
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
  useResumeOnOpen({
    app: props.app,
    opened: { threadId: RESUME_THREAD, started: true, events: [], turns: [], name: null },
    turnDriver: driver,
    moving: false,
  })
  props.probe.driver = driver
  props.probe.failure = failure
  return <text>{failure ?? (driver.working ? 'working' : 'idle')}</text>
}

async function remountOverClaimedRunner() {
  const mounted = await mountCloudResume({ holdTurn: true })
  await act(async () => {
    mounted.driver().handleResume()
    await Bun.sleep(0)
  })
  await mounted.done()
  mounted.app.config.open = { mode: EOpenMode.Continue }
  const probe: RemountProbe = { driver: null, failure: null }
  const setup = await testRender(
    <RemountedView app={mounted.app} probe={probe} events={mounted.original} />,
    { width: 100, height: 8 },
  )
  await setup.flush()
  await act(async () => {
    await Bun.sleep(0)
  })
  await setup.flush()
  const driver = (): TurnDriver => {
    if (probe.driver === null) throw new Error('the remounted view never mounted')
    return probe.driver
  }
  return { mounted, probe, setup, driver }
}

describe('a remounted conversation over a runner that still owns its turn', () => {
  it('neither auto-resumes nor reports a duplicate-run failure', async () => {
    const { mounted, probe, setup, driver } = await remountOverClaimedRunner()
    try {
      expect(probe.failure).toBeNull()
      expect(mounted.runs).toEqual([{ resume: true }])
      expect(driver().turnInFlight()).toBe(true)
      expect(driver().workingRef.current).toBe(true)
      expect(driver().working).toBe(true)
    } finally {
      await teardown(setup)
    }
  })

  it('ignores explicit Resume, Resume fresh, Retry and a bare drive', async () => {
    const { mounted, probe, setup, driver } = await remountOverClaimedRunner()
    try {
      await act(async () => {
        driver().handleResume()
        driver().handleResumeFresh()
        driver().handleRetry()
        await driver().drive([])
        await Bun.sleep(0)
      })
      expect(mounted.runs).toEqual([{ resume: true }])
      expect(probe.failure).toBeNull()
      expect(driver().turnInFlight()).toBe(true)
    } finally {
      await teardown(setup)
    }
  })

  it('goes idle when the original turn completes and then accepts a follow-up', async () => {
    const { mounted, probe, setup, driver } = await remountOverClaimedRunner()
    try {
      const answered: Event[] = mounted.original.map((event) =>
        event.type === 'assistant-said' ? { ...event, interrupted: false } : event,
      )
      mounted.app.log.read = async () => answered
      mounted.app.log.readOwn = async () => answered
      mounted.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('original-run') })
      await act(async () => {
        await Bun.sleep(5)
      })
      await setup.flush()

      expect(probe.failure).toBeNull()
      expect(mounted.runs).toEqual([{ resume: true }])
      expect(driver().turnInFlight()).toBe(false)
      expect(driver().working).toBe(false)

      await act(async () => {
        await driver().drive([{ type: 'user-said', text: 'next step' }])
      })
      expect(mounted.channel.sent.map((said) => said.text)).toEqual(['next step'])
      expect(probe.failure).toBeNull()
      expect(driver().turnInFlight()).toBe(true)

      mounted.channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('follow-up-run') })
      await act(async () => {
        await Bun.sleep(5)
      })
      expect(driver().turnInFlight()).toBe(false)
    } finally {
      await teardown(setup)
    }
  })
})
