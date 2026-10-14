import { EFinishReason, toRunId } from '@dltech/atlas-core'
import { ECompactionAnchor } from '@dltech/atlas-core'
import { ERotationPhase, EStepEnd } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { THREAD, spokenIn, until } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { ControlledRotation } from './rotation-fixture'

await grammarsReady()

const WIDE = { width: 150, height: 40 }

const ROW = 'Rotating'

const BRIEF = 'Carry-over brief: the auth work is mid-flight.'

type Mounted = Awaited<ReturnType<typeof testRender>>

const appWith = (rotation: ControlledRotation): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    rotation,
  })

async function landWatermark(app: FakeApp): Promise<number> {
  const events = await app.log.read({ threadId: THREAD })
  const head = events.at(-1)?.seq ?? 1
  await app.log.append({
    threadId: THREAD,
    runId: toRunId('run-rotation'),
    drafts: [
      {
        type: 'history-compacted',
        anchor: ECompactionAnchor.Prefix,
        fromSeq: 1,
        throughSeq: head,
        summary: BRIEF,
        replaced: events.length,
      },
    ],
  })
  return head
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
  it('shows an inline progress row and hands the port the thread, instructions and a settle', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate keep the auth work')

      await frameShowing({ setup, text: ROW })
      expect(rotation.requests).toHaveLength(1)
      expect(rotation.requests[0]?.sessionId).toBe(THREAD)
      expect(rotation.requests[0]?.threadId).toBe(THREAD)
      expect(rotation.requests[0]?.instructions).toBe('keep the auth work')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('keeps the transcript on screen while rotating — it is a row, not an overlay', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')

      const frame = await frameShowing({ setup, text: ROW })
      expect(frame).toContain('what is in here?')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('sends empty instructions when none are given, and settles with no outcome when idle', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: ROW })

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
      await frameShowing({ setup, text: ROW })

      rotation.stage({ sessionId: THREAD, phase: ERotationPhase.Summarising })
      await frameShowing({ setup, text: 'writing the carry-over brief' })

      rotation.stage({ sessionId: THREAD, phase: ERotationPhase.Compacting })
      await frameShowing({ setup, text: 'folding it into the window' })
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('queues a message sent while rotating on the same thread instead of driving a turn', async () => {
    const rotation = new ControlledRotation()
    const app = appWith(rotation)
    const setup = await mounted(app)
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: ROW })
      const driven = app.turnsDriven

      await ran(setup, 'and then run the tests')

      const queued = () =>
        app.pending
          .forThread({ threadId: THREAD })
          .getSnapshot()
          .map((entry) => ('text' in entry ? entry.text : ''))
      expect(queued()).toContain('and then run the tests')
      expect(app.turnsDriven).toBe(driven)

      rotation.resolve({
        kind: 'rotated',
        sessionId: THREAD,
        operationId: 'op',
        threadId: THREAD,
        watermarkSeq: await landWatermark(app),
        replaced: 1,
      })
      await frameWhen({
        setup,
        holds: (drawn) => !drawn.includes(ROW),
        describe: 'the progress row cleared',
      })
      expect(queued()).toContain('and then run the tests')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('stays on the same thread, clears the row and draws the watermark divider when it lands', async () => {
    const rotation = new ControlledRotation()
    const app = appWith(rotation)
    const setup = await mounted(app)
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: ROW })

      rotation.resolve({
        kind: 'rotated',
        sessionId: THREAD,
        operationId: 'op',
        threadId: THREAD,
        watermarkSeq: await landWatermark(app),
        replaced: 1,
      })

      const frame = await frameWhen({
        setup,
        holds: (drawn) => drawn.includes('context compacted') && !drawn.includes(ROW),
        describe: 'the compaction divider with the row cleared',
      })
      expect(frame).toContain('what is in here?')
      expect(rotation.requests).toHaveLength(1)
      const events = await app.log.read({ threadId: THREAD })
      expect(events.some((event) => event.type === 'history-compacted')).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('surfaces a notice and clears the row when the rotation fails', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: ROW })

      rotation.resolve({ kind: 'failed', reason: 'the summary came back empty' })

      const frame = await frameWhen({
        setup,
        holds: (drawn) => drawn.includes('the summary came back empty') && !drawn.includes(ROW),
        describe: 'the failure notice with the row cleared',
      })
      expect(frame).toContain('what is in here?')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('surfaces the reason when the port refuses', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: ROW })

      rotation.resolve({ kind: 'refused', reason: 'nothing to rotate' })

      await frameWhen({
        setup,
        holds: (drawn) => drawn.includes('nothing to rotate') && !drawn.includes(ROW),
        describe: 'the refusal with the row cleared',
      })
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('aborts the request when the operator presses escape', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: ROW })
      expect(rotation.requests[0]?.signal?.aborted).toBe(false)

      setup.mockInput.pressEscape()
      await setup.flush()

      expect(
        await until({ holds: async () => rotation.requests[0]?.signal?.aborted === true, within: 2_000 }),
      ).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('drops the reported usage from the context gauge once the rotation lands', async () => {
    const rotation = new ControlledRotation()
    const app = appWith(rotation)
    const setup = await mounted(app)
    try {
      const publisher = app.channel.publisherFor({ threadId: THREAD })
      publisher.onChunk({
        type: 'finish',
        reason: EFinishReason.Stop,
        usage: { inputTokens: 120_000, outputTokens: 4_000 },
      })
      await frameShowing({ setup, text: '124.0k' })
      publisher.close({ end: EStepEnd.Completed })

      await ran(setup, '/rotate')
      await frameShowing({ setup, text: ROW })
      rotation.resolve({
        kind: 'rotated',
        sessionId: THREAD,
        operationId: 'op',
        threadId: THREAD,
        watermarkSeq: await landWatermark(app),
        replaced: 1,
      })

      await frameWhen({
        setup,
        holds: (drawn) => !drawn.includes('124.0k') && !drawn.includes(ROW),
        describe: 'the gauge off the old window',
      })
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('refuses a second rotation while one is underway', async () => {
    const rotation = new ControlledRotation()
    const setup = await mounted(appWith(rotation))
    try {
      await ran(setup, '/rotate')
      await frameShowing({ setup, text: ROW })
      await ran(setup, '/rotate')

      expect(rotation.requests).toHaveLength(1)
      expect(await until({ holds: async () => rotation.requests.length === 1, within: 200 })).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
