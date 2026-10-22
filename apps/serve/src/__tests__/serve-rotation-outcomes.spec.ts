import { afterEach, describe, expect, it } from 'vitest'
import { toCallId, toRunId } from '@dltech/atlas-core'
import {
  ERuntimePhase,
  runtimeCheckpointSchema,
  type SandboxRotationReceipt,
} from '@dltech/atlas-wire'
import {
  EServeFrame,
  ETurnStatus,
  readPersistedRuntimeCheckpoint,
  readSandboxRotationReceipt,
  runtimeCheckpointFile,
} from '@dltech/atlas-harness'

import { EWorkspaceState } from '../materialize-workspace'
import { createServeDriver } from '../serve-driver'
import { createServeRotationRecovery } from '../serve-rotation-recovery'
import { createServeWorkspaceSession } from '../serve-workspace-session'
import { fakeServeApp } from './fakes'
import {
  childId,
  cleanupRotationFixtures,
  gate,
  replacementSession,
  rotationFixture,
  threadId,
} from './serve-rotation-fixture'

const runId = toRunId('recovery-outcome')
const quietLog = (): void => undefined

afterEach(cleanupRotationFixtures)

const receiptAt = (home: string): Promise<SandboxRotationReceipt | null> =>
  readSandboxRotationReceipt({ atlasHome: home })

const resetReceipt = async (home: string, receipt: SandboxRotationReceipt): Promise<void> => {
  const file = runtimeCheckpointFile({ atlasHome: home })
  const persisted = await readPersistedRuntimeCheckpoint({ file })
  const { persistRuntimeCheckpoint } = await import('@dltech/atlas-harness')
  await persistRuntimeCheckpoint({
    file,
    checkpoint: {
      ...receipt.checkpoint,
      revision: (persisted?.revision ?? 0) + 1,
      receipt,
    },
  })
}

describe('rotation continuation durability', () => {
  it('ignores streaming errors, interrupts and relocation pauses, then durably consumes each real terminal outcome', async () => {
    const fixture = await rotationFixture()
    const recoveryFor = () =>
      createServeRotationRecovery({
        atlasHome: fixture.home,
        threadId,
        sandboxSessionId: replacementSession,
        log: quietLog,
      })
    const retained = await recoveryFor()
    retained.consume({ kind: EServeFrame.Error, message: 'the process disappeared' })
    retained.consume({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.RelocationPaused, runId },
    })
    retained.consume({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Interrupted, runId, committed: false },
    })
    await retained.settled()
    expect(await receiptAt(fixture.home)).toEqual(fixture.receipt)
    for (const outcome of [
      { status: ETurnStatus.Completed, runId } as const,
      { status: ETurnStatus.Idle, runId } as const,
      {
        status: ETurnStatus.Paused,
        runId,
        callId: toCallId('approval-call'),
        reason: 'approval',
      } as const,
      { status: ETurnStatus.Failed, runId, message: 'failed' } as const,
    ]) {
      await resetReceipt(fixture.home, fixture.receipt)
      const recovery = await recoveryFor()
      recovery.consume({ kind: EServeFrame.TurnEnded, outcome })
      await recovery.settled()
      expect((await receiptAt(fixture.home))?.resumeParent).toBe(false)
    }
  })

  it('adopts the deferred children during recovery, then schedules the parent', async () => {
    const fixture = await rotationFixture()
    const model = gate()
    const order: string[] = []
    const app = fakeServeApp({
      threadId,
      root: '/workspace',
      intake: true,
      log: fixture.store.log,
      holdStep: () => model.promise,
      adoptChildren: async () => {
        order.push('children')
        return [childId]
      },
      family: {
        freeze: async () => {
          order.push('guard')
        },
        pauseChildren: async () => undefined,
        resumeChildren: async () => {
          order.push('release')
        },
      },
    })
    const resume = app.runner.resume
    app.runner.resume = (args) => {
      order.push('resume')
      return resume(args)
    }
    const recovery = await createServeRotationRecovery({
      atlasHome: fixture.home,
      threadId,
      sandboxSessionId: replacementSession,
      log: quietLog,
    })
    let opened = false
    await recovery.guard({
      app,
      checkpoint: {
        current: () =>
          opened
            ? runtimeCheckpointSchema.parse({
                threadId: String(threadId),
                runtimeId: 'runtime-1',
                sandboxSessionId: replacementSession,
                revision: 2,
                phase: ERuntimePhase.Serving,
                reportedAt: '2026-10-01T00:00:00.000Z',
                transcript: { head: 1, count: 1, digest: 'a'.repeat(64) },
              })
            : null,
        parkReopened: async () => {
          opened = true
        },
        consumeReceipt: async (given) => {
          const { consumeSandboxRotationReceipt } = await import('@dltech/atlas-harness')
          const receipt = await readSandboxRotationReceipt({ atlasHome: fixture.home })
          if (receipt === null) return
          await consumeSandboxRotationReceipt({
            atlasHome: fixture.home,
            receipt,
            ...(given.parent === true ? { parent: true } : {}),
            ...(given.children === undefined ? {} : { children: given.children.map(String) }),
          })
        },
      },
    })
    const session = createServeWorkspaceSession({
      threadId,
      app,
      deferStartChildren: true,
      log: quietLog,
      settling: { count: 0 },
      note: quietLog,
    })
    const driver = createServeDriver({
      app,
      threadId,
      workspace: { state: EWorkspaceState.Skipped },
      log: quietLog,
      idleStop: () => ({ note: quietLog }),
      emitLifecycle: recovery.consume,
    })
    const detach = app.intake === undefined ? quietLog : driver.attach(app.intake)
    await recovery.recover({ session, driver })
    expect(order).toEqual(['guard', 'children', 'resume', 'release'])
    expect((await receiptAt(fixture.home))?.resumeParent).toBe(true)
    model.release()
    await driver.settled()
    await recovery.settled()
    expect((await receiptAt(fixture.home))?.resumeParent).toBe(false)
    detach()
    app.intake?.dispose()
  })

  it('finishes prior consumption before a new drain and never overwrites the new seal', async () => {
    const fixture = await rotationFixture()
    const recovery = await createServeRotationRecovery({
      atlasHome: fixture.home,
      threadId,
      sandboxSessionId: replacementSession,
      log: quietLog,
    })
    recovery.consume({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Completed, runId },
    })
    await recovery.drain({
      reason: 'next rotation',
      drain: async () => {
        expect((await receiptAt(fixture.home))?.resumeParent).toBe(false)
        await resetReceipt(fixture.home, {
          ...fixture.receipt,
          sandboxSessionId: replacementSession,
          resumeParent: true,
          checkpoint: { ...fixture.receipt.checkpoint, sandboxSessionId: replacementSession },
        })
        return { ok: true, prepared: true, receipt: fixture.receipt }
      },
    })
    recovery.consume({ kind: EServeFrame.TurnEnded, outcome: { status: ETurnStatus.Idle, runId } })
    await recovery.settled()
    expect((await receiptAt(fixture.home))?.resumeParent).toBe(true)
  })

  it('carries unfinished parent and child obligations into another rotation through the drain', async () => {
    const fixture = await rotationFixture()
    await resetReceipt(fixture.home, { ...fixture.receipt, resumeChildren: [childId] })
    const recovery = await createServeRotationRecovery({
      atlasHome: fixture.home,
      threadId,
      sandboxSessionId: replacementSession,
      log: quietLog,
    })
    expect(recovery.owed).toEqual({ parent: true, children: [childId] })
    await recovery.drain({
      reason: 'another replacement',
      drain: async () => ({ ok: true as const, prepared: true as const, receipt: fixture.receipt }),
    })
  })

  it('requires an identified replacement when a journal exists', async () => {
    const fixture = await rotationFixture()
    await expect(
      createServeRotationRecovery({
        atlasHome: fixture.home,
        threadId,
        sandboxSessionId: undefined,
        log: quietLog,
      }),
    ).rejects.toThrow('sandbox rotation recovery requires ATLAS_SANDBOX_SESSION_ID')
  })
})
