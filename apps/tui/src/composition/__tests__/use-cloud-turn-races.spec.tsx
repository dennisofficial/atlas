import { toRunId, type EventDraft } from '@dltech/atlas-core'
import { EClientFrame, ETurnStatus } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'

import { ECommandEffect } from '../commands/local-command'
import { dismissNotice } from '../../ui/notice-store'
import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeApp, scriptedModelPort } from './fake-app'
import { mounted, seeded, THREAD, wire } from './cloud-turn-state-fixture'

await grammarsReady()

const WORKING = 'esc to interrupt'

const RESUME_HINT = 'resume'

const ASKED: EventDraft = { type: 'user-said', text: 'list the packages' }

const ANSWER = 'Five packages live here.'

const arrange = async () => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'unused' }, perChunkMs: 1 }),
  })
  const channel = wire(app)
  const opened = await seeded(app, [ASKED])

  return { app, channel, opened }
}

const running = async () => {
  const arranged = await arrange()
  arranged.channel.ready(true)
  arranged.channel.signal({ type: 'turn-working', working: true })
  const screen = await mounted({ app: arranged.app, opened: arranged.opened })
  await screen.until((frame) => frame.includes(WORKING), 'the working line')

  return { ...arranged, screen }
}

const watching = (wait: Promise<void>) => {
  const state = { settled: false }
  void wait.then(() => {
    state.settled = true
  })
  return state
}

afterEach(() => {
  dismissNotice()
})

describe('what whenSettled waits for on a remote turn', () => {
  it('ignores turn-working false alone and waits for the lifecycle ending', async () => {
    const { channel, screen } = await running()

    try {
      const waiting = screen.conversation().whenSettled()
      const state = watching(waiting)

      channel.signal({ type: 'turn-working', working: false })
      await screen.quiet(200)
      expect(state.settled).toBe(false)

      channel.end(ETurnStatus.Completed)
      await waiting
      expect(state.settled).toBe(true)
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('stays pending for a waiter that registers after turn-working false but before the ending', async () => {
    const { channel, screen } = await running()

    try {
      channel.signal({ type: 'turn-working', working: false })
      await screen.quiet(150)
      expect(screen.conversation().working).toBe(false)

      const waiting = screen.conversation().whenSettled()
      const state = watching(waiting)

      await screen.quiet(200)
      expect(state.settled).toBe(false)

      channel.end(ETurnStatus.Completed)
      await waiting
      expect(state.settled).toBe(true)
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('settles when a reconnect re-readies with no turn in flight', async () => {
    const { channel, screen } = await running()

    try {
      const waiting = screen.conversation().whenSettled()
      const state = watching(waiting)

      await screen.quiet(150)
      expect(state.settled).toBe(false)

      channel.ready(false)
      await waiting
      expect(state.settled).toBe(true)
      expect(screen.conversation().working).toBe(false)
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('is not released by unmounting the screen that asked', async () => {
    const { screen } = await running()
    const state = watching(screen.conversation().whenSettled())

    await screen.done()
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(state.settled).toBe(false)
  }, 30_000)
})

describe('the gap between turn-working false and the lifecycle ending', () => {
  it('offers no resume until the ending settles, then offers it for an unfinished log', async () => {
    const { channel, screen } = await running()

    try {
      channel.signal({ type: 'turn-working', working: false })
      const gap = await screen.quiet(300)

      expect(gap).not.toContain(RESUME_HINT)
      expect(screen.conversation().handleResume).toBeNull()

      channel.end(ETurnStatus.Completed)
      await screen.until((frame) => frame.includes(RESUME_HINT), 'the resume hint after the ending settled')
    } finally {
      await screen.done()
    }
  }, 30_000)

  it('keeps settling for a newer turn that starts inside the gap', async () => {
    const { channel, screen } = await running()

    try {
      channel.signal({ type: 'turn-working', working: false })
      channel.signal({ type: 'turn-working', working: true })
      const frame = await screen.quiet(300)

      expect(frame).toContain(WORKING)
      expect(frame).not.toContain(RESUME_HINT)
      expect(screen.conversation().handleResume).toBeNull()
    } finally {
      await screen.done()
    }
  }, 30_000)
})

describe('the tail of a turn the sandbox ran by itself', () => {
  it('re-reads the log on the ending even when no step signal announced the new events', async () => {
    const { app, channel, screen } = await running()

    try {
      await app.log.append({
        threadId: THREAD,
        runId: toRunId('run-remote'),
        drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: ANSWER }] }],
      })
      await screen.quiet(150)

      channel.end(ETurnStatus.Completed)
      const frame = await screen.until((text) => text.includes(ANSWER), 'the answer after the ending')

      expect(frame).not.toContain(WORKING)
    } finally {
      await screen.done()
    }
  }, 30_000)
})

describe('a local say whose ending races a newer sandbox turn', () => {
  it('keeps the clock and holds queued commands until the newer turn ends', async () => {
    const { app, channel, opened } = await arrange()
    channel.ready(false)
    const screen = await mounted({ app, opened })

    try {
      const ran: string[] = []
      screen.conversation().handleSend({ text: 'and the apps' })
      await screen.until(
        () => channel.frames.some((frame) => frame.kind === EClientFrame.Send),
        'the say to reach the channel',
      )
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

      channel.signal({ type: 'turn-working', working: true })
      channel.end(ETurnStatus.Completed)
      channel.signal({ type: 'turn-working', working: true })

      const frame = await screen.until((text) => text.includes(WORKING), 'the working line for the newer turn')
      await screen.quiet(300)

      expect(ran).toEqual([])
      expect(screen.conversation().working).toBe(true)
      expect(screen.conversation().turnInFlight()).toBe(true)
      expect(screen.conversation().turn.startedAt).not.toBeNull()
      expect(frame).toContain(WORKING)

      channel.end(ETurnStatus.Completed)
      await screen.until(() => ran.length > 0, 'the queued command after the newer turn ended')

      expect(ran).toEqual(['/new'])
      expect(screen.conversation().working).toBe(false)
    } finally {
      await screen.done()
    }
  }, 30_000)
})
