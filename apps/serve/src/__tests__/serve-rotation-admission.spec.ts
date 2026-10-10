import { afterEach, describe, expect, it } from 'bun:test'
import { ERuntimePhase } from '@dltech/atlas-wire'

import { createDirectWorkspace } from '../direct-workspace'
import { EWorkspaceState } from '../materialize-workspace'
import { createRuntimeCheckpointCapture } from '../runtime-checkpoint'
import { bindRuntimeCheckpoint } from '../runtime-checkpoint-binding'
import { bindServeDrain } from '../serve-drain-binding'
import { createServeDriver } from '../serve-driver'
import { createServeRotationRecovery } from '../serve-rotation-recovery'
import { createServeWorkspaceSession } from '../serve-workspace-session'
import { fakeServeApp } from './fakes'
import { cleanupRotationFixtures, gate, replacementSession, rotationFixture, threadId, token } from './serve-rotation-fixture'

const noop = (): void => undefined

afterEach(cleanupRotationFixtures)

const rig = async (args: {
  adopt?: () => Promise<void>
  freeze?: () => Promise<void>
  release?: () => Promise<void>
} = {}) => {
  const fixture = await rotationFixture()
  let parentStarts = 0
  let familyResumes = 0
  let adoptions = 0
  let sealing = 0
  const app = fakeServeApp({
    threadId, root: '/workspace', intake: true, log: fixture.store.log,
    adoptChildren: async () => { adoptions += 1; await args.adopt?.(); return [] },
    family: {
      freeze: async () => { await args.freeze?.() },
      pauseChildren: async () => undefined,
      resumeChildren: async () => { familyResumes += 1; await args.release?.() },
    },
  })
  const resume = app.runner.resume
  app.runner.resume = (given) => { parentStarts += 1; return resume(given) }
  const admission = { closed: false }
  const recovery = await createServeRotationRecovery({
    atlasHome: fixture.home, threadId, sandboxSessionId: replacementSession, log: noop,
  })
  await recovery.guard({ app, admission })
  const session = createServeWorkspaceSession({
    direct: createDirectWorkspace({ driveHome: fixture.home, destination: '/workspace' }),
    driveHome: fixture.home, threadId, activeCwd: '/workspace', app,
    dormant: true, deferStartChildren: true, log: noop, settling: { count: 0 }, note: noop,
  })
  const driver = createServeDriver({
    app, threadId, session, admission, workspace: { state: EWorkspaceState.Skipped },
    log: noop, idleStop: () => ({ note: noop }), emitLifecycle: recovery.consume,
  })
  const checkpoint = bindRuntimeCheckpoint({
    capture: createRuntimeCheckpointCapture({
      threadId, atlasHome: fixture.home, env: { ATLAS_SANDBOX_SESSION_ID: replacementSession },
      token, transcript: app.log, log: noop,
    }), log: noop, publish: noop,
  })
  const drain = bindServeDrain({
    app, driver, threadId, atlasHome: fixture.home, sandboxSessionId: replacementSession,
    admission, haltIdle: noop, whenMutationsSettled: async () => undefined,
    checkpoint: { ...checkpoint, finalizeRotation: async () => { sealing += 1; await checkpoint.finalizeRotation() } },
    close: async () => undefined, exit: noop, log: noop,
  })
  return { app, admission, recovery, session, driver, drain,
    parentStarts: () => parentStarts, familyResumes: () => familyResumes,
    adoptions: () => adoptions, sealing: () => sealing }
}

describe('recovery admission while another rotation starts', () => {
  it('waits for an accepted dormant activation before sealing and never resumes or reopens after the drain starts', async () => {
    const entered = gate()
    const held = gate()
    const entry = await rig({ adopt: async () => { entered.release(); await held.promise } })
    await entry.recovery.recover(entry)
    expect(entry.familyResumes()).toBe(1)
    const activation = entry.recovery.activate(entry)
    await entered.promise
    const draining = entry.recovery.drain({ drain: entry.drain, reason: 'next rotation' })
    expect(entry.admission.closed).toBe(true)
    expect(entry.sealing()).toBe(0)
    await expect(entry.recovery.activate(entry)).rejects.toThrow('accepts no new work')
    held.release()
    await activation
    const proof = await draining
    expect(proof.receipt.checkpoint.phase).toBe(ERuntimePhase.Rotating)
    expect(proof.receipt.sandboxSessionId).toBe(replacementSession)
    expect(entry.sealing()).toBe(1)
    expect(entry.admission.closed).toBe(true)
    expect(entry.familyResumes()).toBe(1)
    expect(entry.parentStarts()).toBe(0)
    entry.app.pending?.forThread({ threadId }).enqueue({ text: 'must stay closed' })
    entry.app.intake?.changed()
    await Bun.sleep(10)
    expect(entry.parentStarts()).toBe(0)
    entry.recovery.detach()
    entry.app.intake?.dispose()
  })

  it('waits for an accepted recovery release but never reopens admission when its family callback returns', async () => {
    const entered = gate()
    const held = gate()
    const entry = await rig({ release: async () => { entered.release(); await held.promise } })
    const recovering = entry.recovery.recover(entry)
    await entered.promise
    const draining = entry.recovery.drain({ drain: entry.drain, reason: 'next rotation' })
    expect(entry.admission.closed).toBe(true)
    expect(entry.sealing()).toBe(0)
    held.release()
    await recovering
    await draining
    expect(entry.admission.closed).toBe(true)
    expect(entry.parentStarts()).toBe(0)
    expect(entry.sealing()).toBe(1)
    entry.recovery.detach()
    entry.app.intake?.dispose()
  })

  it('reopens admission and clears the rotation preparation when the drain fails, and a later drain succeeds', async () => {
    const entry = await rig()
    await entry.recovery.recover(entry)
    expect(entry.admission.closed).toBe(false)
    entry.app.endProcesses = async () => { throw new Error('processes refused to stop') }
    await expect(entry.recovery.drain({ drain: entry.drain, reason: 'failed rotation' }))
      .rejects.toThrow('processes refused to stop')
    expect(entry.admission.closed).toBe(false)
    entry.app.endProcesses = undefined
    const proof = await entry.recovery.drain({ drain: entry.drain, reason: 'rotation retry' })
    expect(proof.ok).toBe(true)
    expect(entry.admission.closed).toBe(true)
    entry.recovery.detach()
    entry.app.intake?.dispose()
  })

  it('cancels accepted activation still waiting on the guard without starting children', async () => {
    const entered = gate()
    const held = gate()
    let freezes = 0
    const entry = await rig({ freeze: async () => {
      freezes += 1
      if (freezes === 1) return
      entered.release()
      await held.promise
    } })
    await entry.recovery.recover(entry)
    const activation = entry.recovery.activate(entry)
    await entered.promise
    const draining = entry.recovery.drain({ drain: entry.drain, reason: 'next rotation' })
    held.release()
    expect(await activation).toEqual({ activated: false })
    await draining
    expect(entry.session.dormant()).toBe(true)
    expect(entry.adoptions()).toBe(0)
    expect(entry.parentStarts()).toBe(0)
    expect(entry.familyResumes()).toBe(1)
    expect(entry.admission.closed).toBe(true)
    entry.recovery.detach()
    entry.app.intake?.dispose()
  })
})
