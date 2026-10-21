import { afterEach, describe, expect, it } from 'vitest'

import { EClientFrame, EServeFrame, ETurnStatus, readSandboxRotationReceipt, toSendId } from '@dltech/atlas-harness'

import { createServeRotationRecovery } from '../serve-rotation-recovery'
import { createServeWorkspaceSession } from '../serve-workspace-session'
import type { ServeTurnDriver, TurnRunOptions } from '../turn-driver'
import { connect } from './client'
import { fakeServeApp } from './fakes'
import { cleanupRotationFixtures, rotationFixture, sourceSession, threadId, token } from './serve-rotation-fixture'

const noop = (): void => undefined

const settledOnce = async (outcomes: readonly unknown[]): Promise<void> => {
  for (let attempt = 0; attempt < 2000 && outcomes.length === 0; attempt += 1) await Bun.sleep(5)
}

const parentOwed = async (home: string): Promise<boolean> =>
  (await readSandboxRotationReceipt({ atlasHome: home }))?.resumeParent === true

afterEach(cleanupRotationFixtures)

const recordingDriver = (runs: (TurnRunOptions | undefined)[]): ServeTurnDriver => ({
  beginRelocation: async () => undefined, relocationResumable: () => false, busy: () => false,
  say: async () => undefined, run: (options) => { runs.push(options) }, sayOrRun: () => false,
  interrupt: noop, pause: noop, resume: noop,
  running: () => false, outcomePending: () => false, settled: async () => undefined,
  attach: () => noop, holdHistory: () => noop,
  beginRotation: () => ({ pause: noop, waitSettled: async () => null }), holdForRotation: () => noop,
})

describe('in-place swap over a receipt sealed in the same sandbox session', () => {
  it('resumes the owed parent from the transcript when the session id matches the receipt', async () => {
    const fixture = await rotationFixture()
    expect(fixture.receipt.sandboxSessionId).toBe(sourceSession)
    const app = fakeServeApp({ threadId, root: '/workspace', intake: true, log: fixture.store.log })
    const recovery = await createServeRotationRecovery({
      atlasHome: fixture.home, threadId, sandboxSessionId: sourceSession, log: noop,
    })
    expect(recovery.deferred).toBe(true)
    expect(recovery.owed).toEqual({ parent: true, children: [] })
    await recovery.guard({
      app,
      checkpoint: { current: () => null, parkReopened: async () => undefined, consumeReceipt: async () => undefined },
    })
    const session = createServeWorkspaceSession({
      threadId, app, deferStartChildren: true, log: noop, settling: { count: 0 }, note: noop,
    })
    const runs: (TurnRunOptions | undefined)[] = []
    await recovery.recover({ session, driver: recordingDriver(runs) })
    expect(runs).toEqual([{ resume: true, onlyIfIdle: true }])
    app.intake?.dispose()
  })

  it('keeps the 2026-10-09 wedge fixed: after the resumed turn the swapped serve accepts new work', async () => {
    const fixture = await rotationFixture()
    const boot = await fixture.boot({ sessionId: sourceSession })
    const handle = await boot.starting
    await settledOnce(boot.outcomes)
    expect(boot.resumed()).toBe(1)
    const client = await connect({ port: handle.port, token })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: toSendId('send-after-swap'), text: 'new work after the swap' })
    const ended = await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    expect(ended.kind === EServeFrame.TurnEnded && ended.outcome.status).toBe(ETurnStatus.Completed)
    expect(JSON.stringify(client.frames)).not.toContain('accepts no new work')
    client.close()
  }, 20_000)

  it('discharges the receipt once the resumed turn completes, so a later same-session boot does not resume again', async () => {
    const fixture = await rotationFixture()
    expect(await parentOwed(fixture.home)).toBe(true)
    const first = await fixture.boot({ sessionId: sourceSession })
    const firstHandle = await first.starting
    await settledOnce(first.outcomes)
    expect(first.outcomes.map((outcome) => outcome.status)).toEqual([ETurnStatus.Completed])
    for (let attempt = 0; attempt < 2000 && (await parentOwed(fixture.home)); attempt += 1) await Bun.sleep(5)
    expect(await parentOwed(fixture.home)).toBe(false)
    await firstHandle.close()
    const second = await fixture.boot({ sessionId: sourceSession })
    await second.starting
    expect(second.resumed()).toBe(0)
    expect(second.ran()).toBe(0)
  }, 20_000)
})
