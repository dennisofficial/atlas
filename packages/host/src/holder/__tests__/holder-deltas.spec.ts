import { describe, expect, it } from 'bun:test'

import { EStepEndReason } from '@dltech/atlas-core'
import type { LiveFrame } from '@dltech/atlas-protocol'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, THREAD_ID } from './holder-rig'

const ANSWER = 'The quick brown fox jumps over the lazy dog. '.repeat(8)

describe('SessionHolder live deltas', () => {
  it('publishes step-start, deltas and step-end that rebuild the assistant text', async () => {
    const rig = await makeRig({ script: [{ text: ANSWER, streamMs: 40 }] })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'go')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)

    const frames: LiveFrame[] = rig.bus.frames
      .filter((entry) => entry.sessionId === SESSION)
      .map((entry) => entry.frame)
    const stepFrames = frames.filter((frame) =>
      ['step-start', 'delta', 'step-end'].includes(frame.type),
    )
    expect(stepFrames[0]?.type).toBe('step-start')
    const last = stepFrames.at(-1)
    expect(last?.type === 'step-end' && last.reason).toBe(EStepEndReason.Finished)

    const byBlock = new Map<string, string>()
    for (const frame of stepFrames) {
      if (frame.type !== 'delta') continue
      const have = byBlock.get(frame.block) ?? ''
      expect(frame.from).toBe(have.length)
      byBlock.set(frame.block, have + frame.text)
    }

    const page = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq: 0,
      limit: 1000,
      visible: false,
    })
    const said = page.events.find((event) => event.type === 'assistant-said')
    if (said?.type !== 'assistant-said') throw new Error('expected assistant-said')
    const finalText = said.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
    expect([...byBlock.values()]).toEqual([finalText.join('')])
  })

  it('a tool-only step and the answer after it stream under distinct keys', async () => {
    const rig = await makeRig({
      script: [
        { calls: [{ callId: 'c1', name: 'bash', input: { command: 'echo hi' } }] },
        { text: ANSWER, streamMs: 20 },
      ],
    })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'go')
    const saw = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(saw).toBe(true)
    const starts = rig.bus.frames.flatMap((entry) =>
      entry.frame.type === 'step-start' ? [JSON.stringify(entry.frame.key)] : [],
    )
    expect(starts.length).toBe(2)
    expect(new Set(starts).size).toBe(2)
  })
})
