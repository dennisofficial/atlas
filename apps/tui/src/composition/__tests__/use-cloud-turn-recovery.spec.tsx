import { afterEach, describe, expect, it } from 'bun:test'
import { EClientFrame, ETurnStatus } from '@dltech/atlas-harness'

import { ECommandEffect } from '../commands/local-command'
import { dismissNotice } from '../../ui/notice-store'
import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeApp, scriptedModelPort } from './fake-app'
import { ASKED, CHILD, mirrored, runsOf } from './cloud-mirror-fixture'
import { mounted } from './cloud-turn-state-fixture'

await grammarsReady()

const WORKING = 'esc to interrupt'

const RESUME_HINT = 'resume'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  dismissNotice()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const open = async (args: { readyAtMount?: boolean; wakesInto?: boolean; inFlight?: boolean }) => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'unused' }, perChunkMs: 1 }),
  })
  const rig = await mirrored({
    app,
    seeded: [ASKED, CHILD],
    hold: false,
    inFlight: args.inFlight === true,
    ...(args.readyAtMount === undefined ? {} : { readyAtMount: args.readyAtMount }),
    ...(args.wakesInto === undefined ? {} : { wakesInto: args.wakesInto }),
  })
  const screen = await mounted({ app, opened: rig.opened })
  cleanups.push(async () => {
    await screen.done()
    await rig.cleanup()
  })

  return { rig, screen }
}

describe('settling before the channel is open', () => {
  it('keeps resume for an interrupted prefix once the first idle Ready is followed by Open', async () => {
    const { rig, screen } = await open({ readyAtMount: false })
    await screen.until((frame) => frame.includes(RESUME_HINT), 'the resume hint on the mounted prefix')

    rig.wired.ready(false)
    await screen.quiet(500)

    expect(await screen.quiet(100)).toContain(RESUME_HINT)
    expect(screen.conversation().handleResume).not.toBeNull()
  }, 30_000)

  it('keeps resume after a reconnect re-readies idle', async () => {
    const { rig, screen } = await open({})
    await screen.until((frame) => frame.includes(RESUME_HINT), 'the resume hint')

    rig.wired.drop()
    rig.wired.reopen()
    rig.wired.ready(false)
    await screen.quiet(400)

    expect(await screen.quiet(100)).toContain(RESUME_HINT)
    expect(screen.conversation().handleResume).not.toBeNull()
  }, 30_000)

  it('clears the failed-settle suppression when a later Ready settles cleanly', async () => {
    const { rig, screen } = await open({ inFlight: true })
    await screen.until((frame) => frame.includes(WORKING), 'the working line')

    rig.failIdentity('identity unavailable')
    rig.wired.end(ETurnStatus.Completed)
    expect(await screen.quiet(400)).not.toContain(RESUME_HINT)

    rig.failIdentity(null)
    rig.wired.ready(false)
    await screen.until((frame) => frame.includes(RESUME_HINT), 'the resume hint after a clean settle')
  }, 30_000)
})

describe('pressing resume on a parked sandbox', () => {
  it('wakes the runner, synchronizes, and sends the resume run without a failure', async () => {
    const { rig, screen } = await open({ wakesInto: false })
    await screen.until((frame) => frame.includes(RESUME_HINT), 'the resume hint')
    rig.wired.park()

    screen.conversation().handleResume?.()
    await screen.until(() => runsOf(rig).length > 0, 'the resume run after the wake')
    const frame = await screen.quiet(200)

    expect(rig.wired.wakes.count).toBe(1)
    expect(runsOf(rig)).toEqual([{ kind: EClientFrame.Run, resume: true }])
    expect(frame).not.toContain('cannot synchronize')
  }, 30_000)
})

describe('a settle whose mirror verification fails', () => {
  it('still drains the commands queued behind the turn', async () => {
    const { rig, screen } = await open({ inFlight: true })
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

    rig.failIdentity('identity unavailable')
    rig.wired.end(ETurnStatus.Completed)
    await screen.until(() => ran.length > 0, 'the queued command to drain')

    expect(ran).toEqual(['/new'])
    expect(await screen.quiet(200)).not.toContain(RESUME_HINT)
  }, 30_000)
})
