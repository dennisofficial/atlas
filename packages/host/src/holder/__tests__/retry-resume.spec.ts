import { describe, expect, it } from 'bun:test'

import { ScriptedModel } from '@dltech/atlas-agent/testing'
import {
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  ERunFailureKind,
  type V2Event,
} from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const CALL_ID = 'c1'

const authFailure = ({ message }: { message: string }) => ({
  kind: EProviderFailureKind.Auth,
  scope: EProviderFailureScope.Credential,
  retry: EProviderRetry.Never,
  message,
})

const eventsOf = async (rig: HolderRig): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 400, visible: false }))
    .events

const authFailed = async (rig: HolderRig): Promise<boolean> =>
  (await eventsOf(rig)).some(
    (event) => event.type === 'run-failed' && event.failure.kind === ERunFailureKind.Auth,
  )

const retryOf = async (rig: HolderRig, payload: string) => {
  const { inboxId } = await rig.plane.post({ sessionId: SESSION, kind: 'retry', payload })
  await rig.wake()
  return inboxId
}

describe('a retry after a turn failed on a credential', () => {
  it('restarts the turn from the log without replaying the calls it settled', async () => {
    const model = new ScriptedModel([
      { calls: [{ callId: CALL_ID, name: 'bash', input: { command: 'echo run >> runs' } }] },
      { throws: new Error('the key was revoked') },
      { text: 'after the retry' },
    ])
    const rig = await makeRig({ model: () => model, normalizeFailure: authFailure })
    await seedSession(rig)
    await rig.post('do the work')
    await rig.holder.start()
    await rig.wake()
    expect(await flushUntil({ check: async () => await authFailed(rig), clock: rig.clock })).toBe(
      true,
    )
    await rig.flush()
    const before = await eventsOf(rig)

    await retryOf(rig, '{}')
    expect(
      await flushUntil({
        check: async () => (await eventsOf(rig)).some((event) => event.type === 'assistant-said'),
        clock: rig.clock,
        advanceMs: 60_000,
        attempts: 200,
      }),
    ).toBe(true)

    const after = await eventsOf(rig)
    expect(
      after.filter((event) => event.type === 'tool-dispatched' && event.callId === CALL_ID),
    ).toHaveLength(1)
    expect(after.filter((event) => event.type === 'run-failed')).toHaveLength(
      before.filter((event) => event.type === 'run-failed').length,
    )
    expect(after.filter((event) => event.type === 'assistant-said')).toMatchObject([
      { parts: [{ type: 'text', text: 'after the retry' }] },
    ])
  })

  it('never turns the retry into a user message', async () => {
    const rig = await makeRig({ normalizeFailure: authFailure, script: [{ text: 'done' }] })
    await seedSession(rig)
    await rig.post('do the work')
    await rig.holder.start()
    await rig.wake()
    await rig.flush()

    const inboxId = await retryOf(rig, '{}')
    expect(
      await flushUntil({
        check: async () =>
          (await eventsOf(rig)).some(
            (event) => event.type === 'input-consumed' && event.inboxId === inboxId,
          ),
        clock: rig.clock,
      }),
    ).toBe(true)

    const events = await eventsOf(rig)
    expect(events.filter((event) => event.type === 'user-said')).toMatchObject([
      { text: 'do the work' },
    ])
    expect(
      events.find((event) => event.type === 'input-consumed' && event.inboxId === inboxId),
    ).toMatchObject({ consumed: 'discarded' })
  })
})
