import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

class PermanentError extends Error {}

const failOnce = () => {
  let failed = false
  return async () => {
    if (failed) return
    failed = true
    throw new PermanentError('no sandbox')
  }
}

const recordedEvents = async (rig: Awaited<ReturnType<typeof makeRig>>) =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 200, visible: false }))
    .events

describe('a retry inbox entry after a start failure', () => {
  it('records the readable reason the host gives for the error', async () => {
    const rig = await makeRig({
      beforeRuntime: failOnce(),
      isPermanentStartError: (error) => error instanceof PermanentError,
      reasonOfStartError: () => 'Connect Vercel in Settings, then retry.',
    })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    const recorded = await flushUntil({
      check: async () =>
        (await recordedEvents(rig)).some((event) => event.type === 'session-start-failed'),
    })
    expect(recorded).toBe(true)
    expect(
      (await recordedEvents(rig)).find((e) => e.type === 'session-start-failed'),
    ).toMatchObject({ reason: 'Connect Vercel in Settings, then retry.', permanent: true })
  })

  it('is claimed, consumed as discarded and never becomes a user message', async () => {
    const rig = await makeRig({
      beforeRuntime: failOnce(),
      isPermanentStartError: (error) => error instanceof PermanentError,
    })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    await flushUntil({
      check: async () =>
        (await recordedEvents(rig)).some((event) => event.type === 'session-start-failed'),
    })
    await rig.flush()

    const retry = await rig.plane.post({ sessionId: SESSION, kind: 'retry', payload: '{}' })
    await rig.wake()
    const consumed = await flushUntil({
      check: async () =>
        (await recordedEvents(rig)).some(
          (event) =>
            event.type === 'input-consumed' &&
            (event as { inboxId?: number }).inboxId === retry.inboxId,
        ),
    })
    expect(consumed).toBe(true)
    const events = await recordedEvents(rig)
    expect(
      events.find(
        (event) =>
          event.type === 'input-consumed' &&
          (event as { inboxId?: number }).inboxId === retry.inboxId,
      ),
    ).toMatchObject({ consumed: 'discarded' })
    expect(
      events.filter(
        (event) =>
          event.type === 'user-said' && (event as { inboxId?: number }).inboxId === retry.inboxId,
      ),
    ).toEqual([])
  })
})
