import { toStepId, ETurnStatus, EClientFrame, EStepEnd } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'

import { dismissNotice } from '../../ui/notice-store'
import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeApp, scriptedModelPort } from './fake-app'
import { ASKED, CHILD, mirrored } from './cloud-mirror-fixture'
import { mounted } from './cloud-turn-state-fixture'

await grammarsReady()

const WORKING = 'esc to interrupt'

const RESUME_HINT = 'resume'

const ANSWER = 'The packages are migrated.'

const STEP = toStepId('cloud-mirror#1')

const FINAL: { type: 'assistant-said'; parts: { type: 'text'; text: string }[]; interrupted?: boolean } = {
  type: 'assistant-said',
  parts: [{ type: 'text', text: ANSWER }],
}

const INTERRUPTED = { ...FINAL, parts: [{ type: 'text' as const, text: 'Surveying the' }], interrupted: true }

const arrange = async (args: { hold: boolean; inFlight: boolean }) => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'unused' }, perChunkMs: 1 }),
  })
  const rig = await mirrored({ app, seeded: [ASKED, CHILD], ...args })
  const screen = await mounted({ app, opened: rig.opened })

  return { rig, screen }
}

const runs = (rig: Awaited<ReturnType<typeof mirrored>>) =>
  rig.wired.frames.filter((frame) => frame.kind === EClientFrame.Run)

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  dismissNotice()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const open = async (args: { hold: boolean; inFlight: boolean }) => {
  const arranged = await arrange(args)
  cleanups.push(async () => {
    await arranged.screen.done()
    await arranged.rig.cleanup()
  })

  return arranged
}

describe('a parent that completes while its child still runs', () => {
  it('offers no resume while the final answer is still reaching the mirror', async () => {
    const { rig, screen } = await open({ hold: true, inFlight: true })
    await screen.until((frame) => frame.includes(WORKING), 'the working line')

    rig.sandboxAppends(FINAL)
    rig.wired.signal({ type: 'step-started', stepId: STEP })
    rig.wired.signal({ type: 'chunk', stepId: STEP, chunk: { type: 'text-delta', id: 'a', text: ANSWER } })
    rig.wired.signal({ type: 'step-ended', stepId: STEP, end: EStepEnd.Completed, supersededBy: null })
    rig.wired.end(ETurnStatus.Completed)
    await rig.entered

    const held = await screen.quiet(400)
    expect(held).not.toContain(RESUME_HINT)
    expect(screen.conversation().handleResume).toBeNull()
    expect(runs(rig)).toEqual([])

    rig.release()
    await screen.until((frame) => frame.includes(ANSWER), 'the final answer after the mirror write')
    const settled = await screen.quiet(300)

    expect(settled).not.toContain(RESUME_HINT)
    expect(screen.conversation().handleResume).toBeNull()
    expect(runs(rig)).toEqual([])
  }, 30_000)

  it('still offers resume for a real interruption with the child running', async () => {
    const { rig, screen } = await open({ hold: false, inFlight: true })
    await screen.until((frame) => frame.includes(WORKING), 'the working line')

    rig.sandboxAppends(INTERRUPTED)
    rig.wired.interrupted()
    await screen.until((frame) => frame.includes(RESUME_HINT), 'the resume hint after the mirror caught up')

    screen.conversation().handleResume?.()
    await screen.until(() => runs(rig).length > 0, 'the resume run reaching the sandbox')

    expect(runs(rig)).toEqual([{ kind: EClientFrame.Run, resume: true }])
  }, 30_000)

  it('keeps resume hidden when the authoritative settle fails on stale events', async () => {
    const { rig, screen } = await open({ hold: false, inFlight: true })
    await screen.until((frame) => frame.includes(WORKING), 'the working line')

    rig.failIdentity('identity unavailable')
    rig.sandboxAppends(FINAL)
    const waiting = screen.conversation().whenSettled()
    rig.wired.end(ETurnStatus.Completed)
    await waiting

    const frame = await screen.quiet(400)
    expect(frame).not.toContain(RESUME_HINT)
    expect(screen.conversation().handleResume).toBeNull()
  }, 30_000)
})

describe('pressing resume on a mirrored interrupted tail', () => {
  it('sends no run when the sandbox already completed the turn', async () => {
    const { rig, screen } = await open({ hold: true, inFlight: false })
    rig.sandboxAppends(INTERRUPTED)
    rig.wired.ready(false)
    await screen.until((frame) => frame.includes(RESUME_HINT), 'the stale resume hint')
    rig.sandboxAppends(FINAL)

    screen.conversation().handleResume?.()
    await rig.entered
    await screen.quiet(200)
    expect(runs(rig)).toEqual([])

    rig.release()
    await screen.until((frame) => frame.includes(ANSWER), 'the completed answer')
    const frame = await screen.quiet(300)

    expect(frame).not.toContain(RESUME_HINT)
    expect(runs(rig)).toEqual([])
  }, 30_000)

  it('sends no run and reports the failure when the mirror cannot be verified', async () => {
    const { rig, screen } = await open({ hold: false, inFlight: false })
    rig.wired.ready(false)
    await screen.until((frame) => frame.includes(RESUME_HINT), 'the resume hint')

    rig.failIdentity('boom')
    screen.conversation().handleResume?.()
    const frame = await screen.until((text) => text.includes('boom'), 'the failure')

    expect(frame).not.toContain(RESUME_HINT)
    expect(runs(rig)).toEqual([])
  }, 30_000)
})
