import { afterEach, describe, expect, it } from 'bun:test'
import { toCallId, toRunId } from '@dltech/atlas-core'
import { EServeFrame, ETurnStatus, persistSandboxRotationIntent, persistSandboxRotationReceipt, readSandboxRotationState } from '@dltech/atlas-harness'

import { createDirectWorkspace } from '../direct-workspace'
import { EWorkspaceState } from '../materialize-workspace'
import { createServeDriver } from '../serve-driver'
import { createServeRotationRecovery } from '../serve-rotation-recovery'
import { createServeWorkspaceSession } from '../serve-workspace-session'
import { fakeServeApp } from './fakes'
import { childId, cleanupRotationFixtures, gate, replacementSession, rotationFixture, threadId } from './serve-rotation-fixture'

const runId = toRunId('recovery-outcome')
const quietLog = (): void => undefined

afterEach(cleanupRotationFixtures)

describe('rotation continuation durability', () => {
  it('ignores streaming errors, interrupts and relocation pauses, then durably consumes each real terminal outcome', async () => {
    const fixture = await rotationFixture()
    const recoveryFor = () => createServeRotationRecovery({
      atlasHome: fixture.home, threadId, sandboxSessionId: replacementSession, log: quietLog,
    })
    const retained = await recoveryFor()
    retained.consume({ kind: EServeFrame.Error, message: 'the process disappeared' })
    retained.consume({ kind: EServeFrame.TurnEnded, outcome: { status: ETurnStatus.RelocationPaused, runId } })
    retained.consume({ kind: EServeFrame.TurnEnded, outcome: { status: ETurnStatus.Interrupted, runId, committed: false } })
    await retained.settled()
    expect(await readSandboxRotationState({ atlasHome: fixture.home })).toEqual(fixture.receipt)
    for (const outcome of [
      { status: ETurnStatus.Completed, runId } as const,
      { status: ETurnStatus.Idle, runId } as const,
      { status: ETurnStatus.Paused, runId, callId: toCallId('approval-call'), reason: 'approval' } as const,
      { status: ETurnStatus.Failed, runId, message: 'failed' } as const,
    ]) {
      await persistSandboxRotationReceipt({ atlasHome: fixture.home, receipt: fixture.receipt })
      const recovery = await recoveryFor()
      recovery.consume({ kind: EServeFrame.TurnEnded, outcome })
      await recovery.settled()
      expect((await readSandboxRotationState({ atlasHome: fixture.home }))?.resumeParent).toBe(false)
    }
  })

  it('waits for dormant workspace activation and re-guards adoption before scheduling the parent', async () => {
    const fixture = await rotationFixture()
    const model = gate()
    const order: string[] = []
    const app = fakeServeApp({
      threadId, root: '/workspace', intake: true, log: fixture.store.log,
      holdStep: () => model.promise,
      adoptChildren: async () => { order.push('children'); return [childId] },
      family: {
        freeze: async () => { order.push('guard') },
        pauseChildren: async () => undefined,
        resumeChildren: async () => { order.push('release') },
      },
    })
    const resume = app.runner.resume
    app.runner.resume = (args) => { order.push('resume'); return resume(args) }
    const admission = { closed: false }
    const recovery = await createServeRotationRecovery({
      atlasHome: fixture.home, threadId, sandboxSessionId: replacementSession, log: quietLog,
    })
    await recovery.guard({ app, admission })
    const session = createServeWorkspaceSession({
      direct: createDirectWorkspace({ driveHome: fixture.home, destination: '/workspace' }),
      driveHome: fixture.home, threadId, activeCwd: '/workspace', app,
      dormant: true, deferStartChildren: true, log: quietLog, settling: { count: 0 }, note: quietLog,
    })
    const driver = createServeDriver({
      app, threadId, session, admission, workspace: { state: EWorkspaceState.Skipped },
      log: quietLog, idleStop: () => ({ note: quietLog }), emitLifecycle: recovery.consume,
    })
    const detach = app.intake === undefined ? quietLog : driver.attach(app.intake)
    await recovery.recover({ session, driver })
    expect(order).toEqual(['guard', 'release'])
    expect(session.dormant()).toBe(true)
    expect((await readSandboxRotationState({ atlasHome: fixture.home }))?.resumeParent).toBe(true)
    await recovery.activate({ session, driver })
    expect(order).toEqual(['guard', 'release', 'guard', 'children', 'resume', 'release'])
    expect(session.dormant()).toBe(false)
    expect((await readSandboxRotationState({ atlasHome: fixture.home }))?.resumeParent).toBe(true)
    model.release()
    await driver.settled()
    await recovery.settled()
    expect((await readSandboxRotationState({ atlasHome: fixture.home }))?.resumeParent).toBe(false)
    detach()
    app.intake?.dispose()
  })

  it('finishes prior consumption before a new drain intent and never overwrites the new preparation', async () => {
    const fixture = await rotationFixture()
    const recovery = await createServeRotationRecovery({
      atlasHome: fixture.home, threadId, sandboxSessionId: replacementSession, log: quietLog,
    })
    recovery.consume({ kind: EServeFrame.TurnEnded, outcome: { status: ETurnStatus.Completed, runId } })
    await recovery.drain({
      reason: 'next rotation',
      drain: async () => {
        expect((await readSandboxRotationState({ atlasHome: fixture.home }))?.resumeParent).toBe(false)
        await persistSandboxRotationIntent({
          atlasHome: fixture.home, threadId, sandboxSessionId: replacementSession, resumeParent: true,
        })
        return { ok: true, prepared: true, receipt: fixture.receipt }
      },
    })
    recovery.consume({ kind: EServeFrame.TurnEnded, outcome: { status: ETurnStatus.Idle, runId } })
    await recovery.settled()
    expect(await readSandboxRotationState({ atlasHome: fixture.home })).toEqual({
      version: 1, preparing: true, threadId, sandboxSessionId: replacementSession, resumeParent: true,
    })
  })

  it('carries unfinished parent and child obligations into another rotation before the drain writes its intent', async () => {
    const fixture = await rotationFixture()
    await persistSandboxRotationReceipt({
      atlasHome: fixture.home, receipt: { ...fixture.receipt, resumeChildren: [childId] },
    })
    const recovery = await createServeRotationRecovery({
      atlasHome: fixture.home, threadId, sandboxSessionId: replacementSession, log: quietLog,
    })
    await recovery.drain({
      reason: 'another replacement',
      drain: async () => {
        expect(await readSandboxRotationState({ atlasHome: fixture.home })).toEqual({
          version: 1, preparing: true, threadId, sandboxSessionId: replacementSession,
          resumeParent: true, resumeChildren: [childId],
        })
        return { ok: true, prepared: true, receipt: fixture.receipt }
      },
    })
  })

  it('requires an identified replacement when a journal exists', async () => {
    const fixture = await rotationFixture()
    await expect(createServeRotationRecovery({
      atlasHome: fixture.home, threadId, sandboxSessionId: undefined, log: quietLog,
    })).rejects.toThrow('sandbox rotation recovery requires ATLAS_SANDBOX_SESSION_ID')
  })
})
