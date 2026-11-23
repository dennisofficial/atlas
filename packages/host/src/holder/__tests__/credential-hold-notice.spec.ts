import { describe, expect, it } from 'bun:test'

import { ScriptedModel } from '@dltech/atlas-agent/testing'
import {
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  ERunFailureKind,
  ESetupPhase,
  inboxEventPayloadOf,
  type V2Event,
} from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const authFailure = () => ({
  kind: EProviderFailureKind.Auth,
  scope: EProviderFailureScope.Credential,
  retry: EProviderRetry.Never,
  message: 'the key was refused',
})

const setupNotice = (): Parameters<typeof inboxEventPayloadOf>[0]['event'] => ({
  type: 'sandbox-setup-reported',
  text: 'setup finished after 1.2s',
  failed: false,
  phase: ESetupPhase.Finished,
})

const eventsOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 400, visible: false }))
    .events

const ofType = (events: readonly V2Event[], type: V2Event['type']): V2Event[] =>
  events.filter((event) => event.type === type)

const authFailed = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<boolean> =>
  (await eventsOf(rig)).some(
    (event) => event.type === 'run-failed' && event.failure.kind === ERunFailureKind.Auth,
  )

const postNotice = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<void> => {
  await rig.plane.post({
    sessionId: SESSION,
    kind: 'event',
    payload: inboxEventPayloadOf({ event: setupNotice(), clientId: 'setup:1' }),
  })
  await rig.wake()
}

const retryOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<void> => {
  await rig.plane.post({ sessionId: SESSION, kind: 'retry', payload: '{}' })
  await rig.wake()
}

describe('a notice that arrives while a credential repair holds the session', () => {
  it('starts no turn, and reaches the retried turn instead', async () => {
    const model = new ScriptedModel([
      { throws: new Error('the key was refused') },
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
    expect(ofType(await eventsOf(rig), 'turn-started')).toHaveLength(1)

    await postNotice(rig)
    await rig.flush()

    const held = await eventsOf(rig)
    expect(ofType(held, 'turn-started')).toHaveLength(1)
    expect(ofType(held, 'assistant-said')).toEqual([])
    expect(ofType(held, 'sandbox-setup-reported')).toEqual([])

    await retryOf(rig)
    expect(
      await flushUntil({
        check: async () => ofType(await eventsOf(rig), 'assistant-said').length > 0,
        clock: rig.clock,
        advanceMs: 60_000,
        attempts: 200,
      }),
    ).toBe(true)

    const after = await eventsOf(rig)
    expect(ofType(after, 'assistant-said')).toMatchObject([
      { parts: [{ type: 'text', text: 'after the retry' }] },
    ])
    expect(ofType(after, 'sandbox-setup-reported')).toHaveLength(1)
    expect(ofType(after, 'turn-started')).toHaveLength(2)
    rig.holder.discard()
  }, 20_000)

  it('still runs the turn an operator message starts', async () => {
    const model = new ScriptedModel([
      { throws: new Error('the key was refused') },
      { text: 'answered' },
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

    await rig.post('try again')
    await rig.wake()
    expect(
      await flushUntil({
        check: async () => ofType(await eventsOf(rig), 'assistant-said').length > 0,
        clock: rig.clock,
        advanceMs: 60_000,
        attempts: 200,
      }),
    ).toBe(true)

    const after = await eventsOf(rig)
    expect(ofType(after, 'turn-started')).toHaveLength(2)
    expect(ofType(after, 'user-said')).toMatchObject([
      { text: 'do the work' },
      { text: 'try again' },
    ])
    rig.holder.discard()
  }, 20_000)
})
