import { describe, expect, it } from 'bun:test'
import { ScriptedModel } from '@dltech/atlas-agent/testing'

import { flushUntil, makeRig, seedSession, THREAD_ID } from './holder-rig'

const typesOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

describe('SessionHolder prepare warnings', () => {
  it('continues the session after a setup warning and tells the model what failed', async () => {
    const model = new ScriptedModel([{ text: 'noted' }])
    const rig = await makeRig({
      model: () => model,
      prepare: async () => ({
        ok: true,
        warnings: ['workspace setup script failed (command: bun install): boom-marker'],
      }),
    })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
    })
    expect(answered).toBe(true)
    const types = await typesOf(rig)
    expect(types).not.toContain('workspace-prepare-failed')
    expect(types.indexOf('sandbox-setup-reported')).toBeLessThan(
      types.indexOf('workspace-prepared'),
    )
    expect(types.indexOf('workspace-prepared')).toBeLessThan(types.indexOf('user-said'))
    const input = JSON.stringify(model.requests[0]?.assembled.messages)
    expect(input).toContain('boom-marker')
    expect(input).toContain('bun install')
  })

  it('keeps the warning in the model input on later turns', async () => {
    const model = new ScriptedModel([{ text: 'one' }, { text: 'two' }])
    const rig = await makeRig({
      model: () => model,
      prepare: async () => ({ ok: true, warnings: ['workspace clone failed: boom-marker'] }),
    })
    await seedSession(rig)
    await rig.post('first')
    await rig.holder.start()
    await rig.wake()
    await flushUntil({ check: () => model.requests.length > 0 })
    await rig.flush()
    await rig.post('second')
    await rig.wake()
    await flushUntil({ check: () => model.requests.length > 1, attempts: 100 })
    expect(JSON.stringify(model.requests[1]?.assembled.messages)).toContain('boom-marker')
  })

  it('caps the warning text sent to the model and keeps the output tail', async () => {
    const model = new ScriptedModel([{ text: 'ok' }])
    const rig = await makeRig({
      model: () => model,
      prepare: async () => ({
        ok: true,
        warnings: [`${'x'.repeat(10_000)}tail-marker`],
      }),
    })
    await seedSession(rig)
    await rig.post('hello')
    await rig.holder.start()
    await rig.wake()
    await flushUntil({ check: () => model.requests.length > 0 })
    const stored = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq: 0,
      limit: 20,
      visible: false,
    })
    const reported = stored.events.find((event) => event.type === 'sandbox-setup-reported')
    const text = reported?.type === 'sandbox-setup-reported' ? reported.text : ''
    expect(text.length).toBeLessThanOrEqual(4096)
    expect(text).toContain('tail-marker')
  })
})
