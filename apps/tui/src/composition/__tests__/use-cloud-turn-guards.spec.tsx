import { toThreadId, type EventDraft } from '@dltech/atlas-core'
import { EClientFrame, ETurnStatus } from '@dltech/atlas-harness'

import { ECommandEffect } from '../commands/local-command'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { useRef } from 'react'

import { SHIPPED_THINKING } from '../../store'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import type { DirectoryMove } from '../directory-move'
import { EThreadRows, useThreadView } from '../use-thread-view'
import { useTurnDriver, type TurnDriver } from '../use-turn-driver'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { mounted, seeded, THREAD, wire } from './cloud-turn-state-fixture'

await grammarsReady()

const WORKING = 'esc to interrupt'

const LOST_NOTICE = 'The sandbox never acknowledged'

const ASKED: EventDraft = { type: 'user-said', text: 'list the packages' }

const STEER = 'and the apps too'

const arrange = async () => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'unused' }, perChunkMs: 1 }),
  })
  const channel = wire(app)
  const opened = await seeded(app, [ASKED])

  return { app, channel, opened }
}

const lostNotices = (): number =>
  currentNotices().filter((notice) => notice.text.startsWith(LOST_NOTICE)).length

type Probe = { driver: TurnDriver | null }

function DriverProbe(props: { app: FakeApp; probe: Probe }): React.ReactNode {
  const started = useRef(true)
  const pendingMove = useRef<DirectoryMove | null>(null)
  const view = useThreadView({
    app: props.app,
    threadId: toThreadId(THREAD),
    rows: EThreadRows.Own,
    thinking: SHIPPED_THINKING,
    readClock: () => 0,
  })
  const driver = useTurnDriver({
    app: props.app,
    threadId: THREAD,
    started,
    pendingMove,
    view,
    readClock: () => 0,
    onSettled: async () => undefined,
    onUndone: () => undefined,
    setFailure: () => undefined,
    forgetUsage: () => undefined,
    cancelCompaction: () => false,
  })
  props.probe.driver = driver

  return <text>{driver.working ? 'working' : 'idle'}</text>
}

afterEach(() => {
  dismissNotice()
})

describe('a channel error that is not about an interrupt', () => {
  it('shows no interrupt-lost notice while idle or while the turn runs un-interrupted', async () => {
    const { app, channel, opened } = await arrange()
    const screen = await mounted({ app, opened })

    try {
      channel.ready(false)
      channel.fail('the disk is full')
      await screen.quiet()
      expect(lostNotices()).toBe(0)

      channel.signal({ type: 'turn-working', working: true })
      await screen.until((frame) => frame.includes(WORKING), 'the working line')
      channel.fail('the disk is still full')
      const frame = await screen.quiet()

      expect(lostNotices()).toBe(0)
      expect(frame).toContain(WORKING)
      expect(screen.conversation().working).toBe(true)
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('still warns and unsticks the interrupting line when an interrupt was pending', async () => {
    const { app, channel, opened } = await arrange()
    channel.ready(true)
    channel.signal({ type: 'turn-working', working: true })
    const screen = await mounted({ app, opened })

    try {
      await screen.until((frame) => frame.includes(WORKING), 'the working line')
      screen.conversation().handleInterrupt()
      await screen.until((frame) => frame.includes('Interrupting'), 'the interrupting line')

      channel.fail('The sandbox never acknowledged the interrupt.')
      const frame = await screen.quiet()

      expect(lostNotices()).toBe(1)
      expect(frame).not.toContain('Interrupting')
    } finally {
      await screen.done()
    }
  }, 30_000)
})

describe('settling a turn the sandbox started by itself', () => {
  it('waits for turn-working false and the outcome, then resolves', async () => {
    const { app, channel, opened } = await arrange()
    channel.ready(true)
    channel.signal({ type: 'turn-working', working: true })
    const screen = await mounted({ app, opened })

    try {
      await screen.until((frame) => frame.includes(WORKING), 'the working line')
      let settled = false
      const waiting = screen.conversation().whenSettled().then(() => {
        settled = true
      })

      await screen.quiet(200)
      expect(settled).toBe(false)

      channel.end(ETurnStatus.Completed)
      await waiting
      expect(settled).toBe(true)
      expect(screen.conversation().working).toBe(false)
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('resolves at once when the sandbox is idle', async () => {
    const { app, channel, opened } = await arrange()
    const screen = await mounted({ app, opened })

    try {
      channel.ready(false)
      await screen.conversation().whenSettled()
      expect(screen.conversation().working).toBe(false)
    } finally {
      await screen.done()
    }
  }, 30_000)
})

describe('work queued for when the sandbox turn settles', () => {
  it('runs a queued settled command once the remote turn ends on its own', async () => {
    const { app, channel, opened } = await arrange()
    channel.ready(true)
    channel.signal({ type: 'turn-working', working: true })
    const screen = await mounted({ app, opened })

    try {
      await screen.until((frame) => frame.includes(WORKING), 'the working line')
      const ran: string[] = []
      screen.conversation().handleQueueSettled({
        name: 'new',
        text: '/new',
        dropsQueue: false,
        losesWaiting: false,
        run: () => {
          ran.push('/new')
          return { type: ECommandEffect.Ran }
        },
      })

      await screen.quiet(200)
      expect(ran).toEqual([])

      channel.end(ETurnStatus.Completed)
      await screen.until(() => ran.length > 0, 'the queued command to run on the remote ending')

      expect(ran).toEqual(['/new'])
      expect(screen.conversation().working).toBe(false)
    } finally {
      await screen.done()
    }
  }, 30_000)
})

describe('a rerender while the sandbox turn is running', () => {
  it('keeps whenSettled pending across a paceReveal change until TurnEnded', async () => {
    const { app, channel, opened } = await arrange()
    channel.ready(true)
    channel.signal({ type: 'turn-working', working: true })
    const screen = await mounted({ app, opened })

    try {
      await screen.until((frame) => frame.includes(WORKING), 'the working line')
      let settled = false
      const waiting = screen.conversation().whenSettled().then(() => {
        settled = true
      })

      await screen.togglePaceReveal(true)
      await screen.quiet(200)
      await screen.togglePaceReveal(false)
      await screen.quiet(200)

      expect(settled).toBe(false)
      expect(screen.conversation().working).toBe(true)
      expect(screen.conversation().turnInFlight()).toBe(true)

      channel.end(ETurnStatus.Completed)
      await waiting
      expect(settled).toBe(true)
    } finally {
      await screen.done()
    }
  }, 30_000)
})

describe('a message typed while the sandbox is mid-turn', () => {
  it('steers over the channel instead of starting a second drive', async () => {
    const { app, channel, opened } = await arrange()
    channel.ready(true)
    channel.signal({ type: 'turn-working', working: true })
    const screen = await mounted({ app, opened })
    const eventsBefore = (await app.log.read({ threadId: THREAD })).length

    try {
      await screen.until((frame) => frame.includes(WORKING), 'the working line')
      screen.conversation().handleSend({ text: STEER })
      await screen.quiet(200)

      const sends = channel.frames.filter((frame) => frame.kind === EClientFrame.Send)
      expect(sends).toHaveLength(1)
      expect(sends[0]).toMatchObject({ text: STEER })
      expect(channel.frames.some((frame) => frame.kind === EClientFrame.Run)).toBe(false)
      expect((await app.log.read({ threadId: THREAD })).length).toBe(eventsBefore)
      expect(screen.conversation().working).toBe(true)
    } finally {
      await screen.done()
    }
  }, 30_000)
})

describe('the synchronous working guard on a remote turn', () => {
  it('refuses a drive in the same tick the sandbox reports working, before React renders', async () => {
    const { app, channel } = await arrange()
    const probe: Probe = { driver: null }
    const setup = await testRender(<DriverProbe app={app} probe={probe} />, { width: 40, height: 4 })
    await setup.flush()

    try {
      const driver = (): TurnDriver => {
        if (probe.driver === null) throw new Error('the probe never mounted')
        return probe.driver
      }
      channel.ready(false)
      const stale = driver()
      expect(stale.workingRef.current).toBe(false)

      channel.signal({ type: 'turn-working', working: true })
      expect(stale.workingRef.current).toBe(true)

      let refused: unknown = null
      await stale.drive([ASKED], { onCommitFailed: (error) => (refused = error) })
      expect(refused).toBeInstanceOf(Error)
      expect(channel.frames.some((frame) => frame.kind === EClientFrame.Send)).toBe(false)
      expect(channel.frames.some((frame) => frame.kind === EClientFrame.Run)).toBe(false)

      channel.end(ETurnStatus.Completed)
      expect(stale.workingRef.current).toBe(false)
      await settle(100)
    } finally {
      await teardown(setup)
    }
  }, 30_000)
})
