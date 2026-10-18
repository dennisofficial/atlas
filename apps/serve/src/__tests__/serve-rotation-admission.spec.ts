import { afterEach, describe, expect, it } from 'bun:test'
import { admissionClosedFor, ERuntimePhase } from '@dltech/atlas-wire'

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
  sealFailsOnce?: boolean
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
  const recovery = await createServeRotationRecovery({
    atlasHome: fixture.home, threadId, sandboxSessionId: replacementSession, log: noop,
  })
  const session = createServeWorkspaceSession({
    threadId, app,
    deferStartChildren: false, log: noop, settling: { count: 0 }, note: noop,
  })
  const checkpoint = bindRuntimeCheckpoint({
    capture: createRuntimeCheckpointCapture({
      threadId, atlasHome: fixture.home, env: { ATLAS_SANDBOX_SESSION_ID: replacementSession },
      token, transcript: app.log, log: noop,
    }), log: noop, publish: noop,
  })
  const admissionClosed = (): boolean => {
    if (recovery.admissionLatched) return true
    const current = checkpoint.current()
    return current !== null && admissionClosedFor(current.phase)
  }
  await recovery.guard({ app, checkpoint })
  const driver = createServeDriver({
    app, threadId, workspace: { state: EWorkspaceState.Skipped },
    log: noop, idleStop: () => ({ note: noop }), emitLifecycle: recovery.consume,
  })
  const drain = bindServeDrain({
    app, driver, threadId, atlasHome: fixture.home, sandboxSessionId: replacementSession,
    owed: recovery.owed,
    haltIdle: noop, whenMutationsSettled: async () => undefined,
    checkpoint: {
      ...checkpoint,
      finalizeRotation: async (given) => {
        sealing += 1
        if (args.sealFailsOnce === true && sealing === 1) throw new Error('seal failed')
        await checkpoint.finalizeRotation(given)
      },
    },
    close: async () => undefined, exit: noop, log: noop,
  })
  return { app, admissionClosed, checkpoint, recovery, session, driver, drain,
    parentStarts: () => parentStarts, familyResumes: () => familyResumes,
    adoptions: () => adoptions, sealing: () => sealing }
}

describe('recovery admission while another rotation starts', () => {
  it('seals once the drain settles and never resumes or reopens after the drain starts', async () => {
    const entry = await rig()
    await entry.recovery.recover(entry)
    expect(entry.familyResumes()).toBe(1)
    expect(entry.parentStarts()).toBe(1)
    expect(entry.admissionClosed()).toBe(false)
    const activation = entry.recovery.activate(entry)
    const draining = entry.recovery.drain({ drain: entry.drain, reason: 'next rotation' })
    expect(entry.admissionClosed()).toBe(true)
    expect(entry.sealing()).toBe(0)
    await expect(entry.recovery.activate(entry)).rejects.toThrow('accepts no new work')
    await activation
    const proof = await draining
    expect(proof.receipt.checkpoint.phase).toBe(ERuntimePhase.Updating)
    expect(proof.receipt.sandboxSessionId).toBe(replacementSession)
    expect(entry.sealing()).toBe(1)
    expect(entry.admissionClosed()).toBe(true)
    expect(entry.familyResumes()).toBe(1)
    expect(entry.parentStarts()).toBe(1)
    entry.app.pending?.forThread({ threadId }).enqueue({ text: 'must stay closed' })
    entry.app.intake?.changed()
    await Bun.sleep(10)
    expect(entry.parentStarts()).toBe(1)
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
    expect(entry.admissionClosed()).toBe(true)
    expect(entry.sealing()).toBe(0)
    held.release()
    await recovering
    await draining
    expect(entry.admissionClosed()).toBe(true)
    expect(entry.parentStarts()).toBe(1)
    expect(entry.sealing()).toBe(1)
    entry.recovery.detach()
    entry.app.intake?.dispose()
  })

  it('reopens admission when the drain fails, and a later drain succeeds', async () => {
    const entry = await rig({ sealFailsOnce: true })
    await entry.recovery.recover(entry)
    expect(entry.admissionClosed()).toBe(false)
    await expect(entry.recovery.drain({ drain: entry.drain, reason: 'failed rotation' }))
      .rejects.toThrow('seal failed')
    expect(entry.admissionClosed()).toBe(false)
    const proof = await entry.recovery.drain({ drain: entry.drain, reason: 'rotation retry' })
    expect(proof.ok).toBe(true)
    expect(entry.admissionClosed()).toBe(true)
    entry.recovery.detach()
    entry.app.intake?.dispose()
  })

  it('refuses an activation that arrives once the next rotation is preparing', async () => {
    const entry = await rig()
    await entry.recovery.recover(entry)
    const draining = entry.recovery.drain({ drain: entry.drain, reason: 'next rotation' })
    await expect(entry.recovery.activate(entry)).rejects.toThrow('accepts no new work')
    const proof = await draining
    expect(proof.ok).toBe(true)
    expect(entry.adoptions()).toBe(1)
    expect(entry.parentStarts()).toBe(1)
    expect(entry.familyResumes()).toBe(1)
    expect(entry.admissionClosed()).toBe(true)
    entry.recovery.detach()
    entry.app.intake?.dispose()
  })
})
