import { EFinishReason, toRunId, toThreadId } from '@dltech/atlas-core'
import { ERotationPhase, EStepEnd } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { THREAD, spokenIn, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { ControlledRotation } from './rotation-fixture'

await grammarsReady()

const WIDE = { width: 150, height: 40 }

const HEADING = 'ROTATING'

const SUCCESSOR_SEED = 'You are the successor main agent; the handoff note is on disk.'

type Mounted = Awaited<ReturnType<typeof testRender>>

const appWith = (rotation: ControlledRotation): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    rotation,
  })

async function seedSuccessor(app: FakeApp): Promise<ReturnType<typeof toThreadId>> {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-successor'),
    drafts: [{ type: 'user-said', text: SUCCESSOR_SEED }],
  })
  return thread.id
}

async function mounted(app: FakeApp): Promise<Mounted> {
  const opened = await spokenIn(app)
  const setup = await testRender(<App app={app} opened={opened} />, WIDE)
  await frameShowing({ setup, text: 'what is in here?' })
  return setup
}

async function ran(setup: Mounted, typed: string): Promise<void> {
  await setup.mockInput.typeText(typed)
  await setup.flush()
  setup.mockInput.pressEnter()
  await setup.flush()
  await settle(150)
  await setup.flush()
}

describe('/rotate', () => {
  it('opens the blocking overlay and hands the port the instructions and a settle', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate keep the auth work')

      const frame = await frameShowing({ setup, text: HEADING })
      expect(frame).toContain('Rotating')
      expect(rotation.requests).toHaveLength(1)
      expect(rotation.requests[0]?.sessionId).toBe(THREAD)
      expect(rotation.requests[0]?.predecessor).toBe(THREAD)
      expect(rotation.requests[0]?.instructions).toBe('keep the auth work')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('sends empty instructions when none are given, and settles with no outcome when idle', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })

      const request = rotation.requests[0]
      expect(request?.instructions).toBe('')
      expect(await request?.settle.waitSettled()).toBeNull()
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('follows the port through its phases', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })

      rotation.stage({ sessionId: THREAD, phase: ERotationPhase.Summarising })
      await frameShowing({ setup, text: 'Writing the handoff summary' })

      rotation.stage({ sessionId: THREAD, phase: ERotationPhase.Activating })
      await frameShowing({ setup, text: 'Starting the new main thread' })
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('queues a message sent while the overlay is up instead of driving the predecessor', async () => {
    const rotation = new ControlledRotation()
    const app = appWith(rotation)
    const setup = await mounted(app)
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })
      const driven = app.turnsDriven

      await ran(setup, 'and then run the tests')

      const queued = app.pending.forThread({ threadId: THREAD }).getSnapshot()
      expect(queued.map((entry) => ('text' in entry ? entry.text : ''))).toContain('and then run the tests')
      expect(app.turnsDriven).toBe(driven)
      expect(rotation.requests).toHaveLength(1)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('swaps to the successor on commit and closes the overlay', async () => {
    const rotation = new ControlledRotation()
    const app = appWith(rotation)
    const successor = await seedSuccessor(app)
    const setup = await mounted(app)
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })

      rotation.resolve({
        kind: 'committed',
        sessionId: THREAD,
        operationId: 'op',
        predecessor: THREAD,
        successor,
        handoffPath: '/tmp/handoff.md',
        watermarkSeq: 1,
      })

      const frame = await frameWhen({
        setup,
        holds: (drawn) => drawn.includes(SUCCESSOR_SEED) && !drawn.includes(HEADING),
        describe: 'the successor transcript with the overlay closed',
      })
      expect(frame).not.toContain('what is in here?')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('surfaces a notice and stays on the predecessor when the rotation fails', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })

      rotation.resolve({ kind: 'failed', sessionId: THREAD, operationId: 'op', reason: 'the summary came back empty' })

      const frame = await frameWhen({
        setup,
        holds: (drawn) => drawn.includes('the summary came back empty') && !drawn.includes(HEADING),
        describe: 'the failure notice with the overlay closed',
      })
      expect(frame).toContain('what is in here?')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('drops the predecessor’s reported usage from the context gauge when the successor opens', async () => {
    const rotation = new ControlledRotation()
    const app = appWith(rotation)
    const successor = await seedSuccessor(app)
    const setup = await mounted(app)
    try {
      // The predecessor's last step reported a window past the warn line, the way the ~298k
      // reading did in the live run: the gauge takes a provider count over the log estimate.
      // (62% sits under the warn threshold so the footer spells the tokens, which is what the
      // assertion reads.)
      const publisher = app.channel.publisherFor({ threadId: THREAD })
      publisher.onChunk({
        type: 'finish',
        reason: EFinishReason.Stop,
        usage: { inputTokens: 120_000, outputTokens: 4_000 },
      })
      await frameShowing({ setup, text: '124.0k' })
      publisher.close({ end: EStepEnd.Completed })

      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })
      rotation.resolve({
        kind: 'committed',
        sessionId: THREAD,
        operationId: 'op',
        predecessor: THREAD,
        successor,
        handoffPath: '/tmp/handoff.md',
        watermarkSeq: 1,
      })

      const frame = await frameWhen({
        setup,
        holds: (drawn) => drawn.includes(SUCCESSOR_SEED) && !drawn.includes('124.0k'),
        describe: 'the successor transcript with the gauge on the fresh window',
      })
      expect(frame).not.toContain('124.0k')

      // A predecessor usage landing after the swap — the settle-before-commit race the live run
      // hit — must not move the successor's gauge either: the reading belongs to the thread that
      // measured it, not to whatever conversation happens to be on screen.
      const stale = app.channel.publisherFor({ threadId: THREAD })
      stale.onChunk({
        type: 'finish',
        reason: EFinishReason.Stop,
        usage: { inputTokens: 180_000, outputTokens: 4_000 },
      })
      stale.close({ end: EStepEnd.Completed })
      await settle(150)
      await setup.flush()
      expect(await setup.captureCharFrame()).not.toContain('184.0k')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('keeps the session cost accumulating across the swap while the context gauge resets', async () => {
    const rotation = new ControlledRotation()
    const app = appWith(rotation)
    const successor = await seedSuccessor(app)
    const setup = await mounted(app)
    try {
      // A settled predecessor turn on the ledger: the session cost line must survive the swap
      // (the ledger tree is the session's), even as the context gauge leaves the old window.
      await app.ledger.record({
        runId: toRunId('run-spent'),
        threadId: THREAD,
        status: 'completed',
        providerId: 'anthropic',
        modelId: 'claude-opus-5',
        steps: 1,
        inputTokens: 290_000,
        outputTokens: 7_500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        startedAt: new Date(0).toISOString(),
        endedAt: new Date(0).toISOString(),
        durationMs: 1,
      })

      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })
      rotation.resolve({
        kind: 'committed',
        sessionId: THREAD,
        operationId: 'op',
        predecessor: THREAD,
        successor,
        handoffPath: '/tmp/handoff.md',
        watermarkSeq: 1,
      })

      const frame = await frameWhen({
        setup,
        holds: (drawn) => drawn.includes(SUCCESSOR_SEED),
        describe: 'the successor transcript',
      })
      // The session spend row survives the swap: the successor's open read the ledger tree, so
      // the store now holds that spend even though the gauge left the predecessor's window.
      expect(app.ledger.rows).toHaveLength(1)
      expect(frame).not.toContain('297.5k')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('refuses a second rotation while one is underway', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: HEADING })
      await ran(setup, '/rotate')

      expect(rotation.requests).toHaveLength(1)
      expect(await until({ holds: async () => rotation.requests.length === 1, within: 200 })).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
