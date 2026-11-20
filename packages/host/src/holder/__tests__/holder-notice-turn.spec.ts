import { describe, expect, it } from 'bun:test'

import { ESetupPhase, inboxEventPayloadOf } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

const finishedNotice = (): Parameters<typeof inboxEventPayloadOf>[0]['event'] => ({
  type: 'sandbox-setup-reported',
  text: 'setup finished after 1.2s',
  failed: false,
  phase: ESetupPhase.Finished,
})

describe('SessionHolder over a notice that arrives with no operator message', () => {
  it('delivers the notice to the transcript and runs a turn', async () => {
    const rig = await makeRig({ script: [{ text: 'noted the setup' }] })
    await seedSession(rig)
    await rig.plane.post({
      sessionId: SESSION,
      kind: 'event',
      payload: inboxEventPayloadOf({ event: finishedNotice(), clientId: 'setup:1' }),
    })
    await rig.holder.start()
    await rig.wake()
    const settled = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      attempts: 400,
    })
    expect(settled).toBe(true)
    const types = (await rig.events()).map((event) => event.type)
    expect(types).not.toContain('user-said')
    expect(types).toContain('input-consumed')
    expect(types.indexOf('sandbox-setup-reported')).toBeLessThan(types.indexOf('assistant-said'))
    rig.holder.discard()
  }, 15_000)
})
