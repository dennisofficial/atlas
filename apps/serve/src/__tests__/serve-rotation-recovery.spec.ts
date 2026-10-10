import { afterEach, describe, expect, it } from 'bun:test'
import { access } from 'node:fs/promises'
import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'
import {
  EClientFrame, EServeFrame, ETurnStatus,
  persistSandboxRotationIntent, readPersistedRuntimeCheckpoint, readSandboxRotationState,
  runtimeCheckpointFile, sandboxRotationReceiptFile, transcriptIdentityDigest,
} from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

import { createServeRotationRecovery } from '../serve-rotation-recovery'
import { connect } from './client'
import {
  childId, cleanupRotationFixtures, gate, replacementSession, rotationFixture, sourceSession, threadId, token,
} from './serve-rotation-fixture'

const eventually = async (predicate: () => boolean | Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if (await predicate()) return
    await Bun.sleep(5)
  }
  throw new Error('rotation recovery did not reach the expected state')
}

const owed = async (home: string): Promise<boolean> =>
  (await readSandboxRotationState({ atlasHome: home }))?.resumeParent === true

const checkpointAt = (home: string) =>
  readPersistedRuntimeCheckpoint({ file: runtimeCheckpointFile({ atlasHome: home }) })

const receiptExists = async (home: string): Promise<boolean> =>
  access(sandboxRotationReceiptFile({ atlasHome: home })).then(() => true, () => false)

afterEach(cleanupRotationFixtures)

describe('serve sandbox rotation recovery without a client', () => {
  it('guards adoption, resumes from the durable log, and consumes only terminal completion across two boots', async () => {
    const fixture = await rotationFixture()
    expect(fixture.receipt.checkpoint.transcript.digest).toBe(transcriptIdentityDigest(await fixture.store.log.read({ threadId })))
    const guard = gate()
    const model = gate()
    const order: string[] = []
    const first = await fixture.boot({
      modelGate: model,
      family: {
        freeze: async () => { order.push('guard'); await guard.promise },
        pauseChildren: async () => undefined,
        resumeChildren: async () => { order.push('release') },
      },
      adopt: async () => { order.push('children'); return [childId] },
      onResume: () => { order.push('resume') },
    })
    await eventually(() => order.includes('guard'))
    expect(first.resumed()).toBe(0)
    expect(first.app.adoptions()).toEqual([])
    expect(await checkpointAt(fixture.home)).toEqual(fixture.receipt.checkpoint)
    guard.release()
    const handle = await first.starting
    await eventually(() => first.resumed() === 1)
    expect(order).toEqual(['guard', 'children', 'resume', 'release'])
    expect(first.ran()).toBe(0)
    const health = await fetch(`http://127.0.0.1:${handle.port}/v1/health`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ rotationPreparationVersion: 1, sandboxSessionId: replacementSession, clients: 0 })
    expect(await owed(fixture.home)).toBe(true)
    const progress = await checkpointAt(fixture.home)
    expect(progress?.phase).toBe(ERuntimePhase.Running)
    expect(progress?.sandboxSessionId).toBe(replacementSession)
    expect(await readSandboxRotationState({ atlasHome: fixture.home })).toEqual(fixture.receipt)
    model.release()
    await eventually(async () => !(await owed(fixture.home)))
    expect(first.outcomes.map((outcome) => outcome.status)).toEqual([ETurnStatus.Completed])
    await eventually(async () => !(await receiptExists(fixture.home)))
    await handle.close()
    const second = await fixture.boot()
    await second.starting
    expect(second.resumed()).toBe(0)
    expect(second.ran()).toBe(0)
    expect(second.app.adoptions()).toEqual([threadId])
    expect((await second.disk.log.read({ threadId })).filter((event) => event.type === 'nudge')).toHaveLength(1)
  }, 20_000)

  it('retains the owed continuation after a model crash and resumes on a second fresh boot', async () => {
    const fixture = await rotationFixture()
    const model = gate()
    const first = await fixture.boot({ modelGate: model })
    const handle = await first.starting
    await eventually(async () => (await first.disk.log.read({ threadId })).some((event) => event.type === 'nudge'))
    expect(await owed(fixture.home)).toBe(true)
    await first.modelEntered
    model.fail(new Error('process lost before committing a model result'))
    await eventually(() => first.app.forgotten() === 1)
    expect(first.outcomes).toEqual([])
    expect(await owed(fixture.home)).toBe(true)
    await handle.close()
    const secondModel = gate()
    const second = await fixture.boot({ modelGate: secondModel })
    await second.starting
    expect(second.resumed()).toBe(1)
    expect(await owed(fixture.home)).toBe(true)
    secondModel.release()
    await eventually(async () => !(await owed(fixture.home)))
    expect(second.outcomes.map((outcome) => outcome.status)).toEqual([ETurnStatus.Completed])
    expect((await second.disk.log.read({ threadId })).filter((event) => event.type === 'nudge')).toHaveLength(1)
  }, 20_000)

  it('replaces a same-session preparing intent and boots open without replaying it', async () => {
    const fixture = await rotationFixture()
    await persistSandboxRotationIntent({ atlasHome: fixture.home, threadId, sandboxSessionId: sourceSession, resumeParent: true })
    const order: string[] = []
    const boot = await fixture.boot({
      sessionId: sourceSession,
      family: {
        freeze: async () => { order.push('guard') },
        pauseChildren: async () => undefined,
        resumeChildren: async () => { order.push('release') },
      },
    })
    const handle = await boot.starting
    expect(order).toEqual([])
    expect(boot.app.adoptions()).toEqual([threadId])
    expect(boot.resumed()).toBe(0)
    expect(boot.ran()).toBe(0)
    expect(await readSandboxRotationState({ atlasHome: fixture.home })).toBeNull()
    const client = await connect({ port: handle.port, token })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Run, resume: true })
    const ended = await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    expect(ended.kind === EServeFrame.TurnEnded && ended.outcome.status).toBe(ETurnStatus.Completed)
    expect(JSON.stringify(client.frames)).not.toContain('accepts no new work')
    client.close()
  }, 20_000)

  it('deletes the receipt on a same-session boot and takes ownership of the checkpoint', async () => {
    const fixture = await rotationFixture()
    const boot = await fixture.boot({ sessionId: sourceSession })
    await boot.starting
    expect(boot.resumed()).toBe(0)
    expect(boot.app.adoptions()).toEqual([threadId])
    expect(await readSandboxRotationState({ atlasHome: fixture.home })).toBeNull()
    const checkpoint = await checkpointAt(fixture.home)
    expect(checkpoint?.sandboxSessionId).toBe(sourceSession)
  }, 20_000)

  it('preserves an approval pause instead of forcing the owed parent past it', async () => {
    const fixture = await rotationFixture()
    await fixture.store.log.append({
      threadId, runId: toRunId('approval-pause'), drafts: [
        { type: 'tool-called', callId: toCallId('approval-call'), name: 'write', input: {}, ordinal: 0 },
        { type: 'approval-requested', callId: toCallId('approval-call'), reason: 'approval required' },
      ],
    })
    const boot = await fixture.boot()
    await boot.starting
    expect(boot.resumed()).toBe(0)
    expect(boot.ran()).toBe(0)
    expect(boot.app.adoptions()).toEqual([threadId])
    expect(await owed(fixture.home)).toBe(true)
  }, 20_000)

  it('rejects a journal for another root before composing or starting children', async () => {
    const fixture = await rotationFixture()
    await expect(createServeRotationRecovery({
      atlasHome: fixture.home, threadId: toThreadId('foreign-root'),
      sandboxSessionId: replacementSession, log: () => undefined,
    })).rejects.toThrow('sandbox rotation belongs to rotation-root, not foreign-root')
  })
})
