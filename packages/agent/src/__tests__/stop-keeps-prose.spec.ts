import { describe, expect, it } from 'bun:test'

import { RESUME_NUDGE } from '@dltech/atlas-core'

import { ETurnStatus } from '../loop/turn-outcome'
import { THREAD, rigOf } from './exit-fixture'

const ESSAY = 'It was the best of times, it was the worst of times'

const stoppedRig = (abortReason = 'stop') => {
  const controller = new AbortController()
  let armed = true
  const rig = rigOf({
    script: [{ text: ESSAY, streamMs: 200 }, { text: 'carried on' }],
    overrides: {
      onChunk: (chunk) => {
        if (armed && chunk.type === 'text-delta') {
          armed = false
          controller.abort(abortReason)
        }
        return chunk
      },
    },
  })
  const stop = () =>
    rig.runner.say({ threadId: THREAD, text: 'write me an essay', signal: controller.signal })
  return { rig, stop }
}

const textsOf = (rig: ReturnType<typeof rigOf>) =>
  rig.record
    .eventsOf(THREAD)
    .flatMap((event) => (event.type === 'assistant-said' ? event.parts : []))
    .filter((part) => part.type === 'text')
    .map((part) => part.text)

const nudgesOf = (rig: ReturnType<typeof rigOf>) =>
  rig.record.eventsOf(THREAD).filter((event) => event.type === 'nudge')

describe('a turn the operator stops while the model is streaming', () => {
  it('keeps the prose that had already streamed, marked interrupted', async () => {
    const { rig, stop } = stoppedRig()

    const outcome = await stop()

    expect(outcome.status).toBe(ETurnStatus.Interrupted)
    const reply = rig.record.eventsOf(THREAD).find((event) => event.type === 'assistant-said')
    expect(reply).toMatchObject({ interrupted: true, stopped: true })
    expect(textsOf(rig).join('')).not.toBe('')
    expect(ESSAY.startsWith(textsOf(rig).join(''))).toBe(true)
  })

  it('keeps the stopped prose out of a resume nudge, because the operator asked for it', async () => {
    const { rig, stop } = stoppedRig()
    await stop()

    await rig.runner.say({ threadId: THREAD, text: 'go on' })

    expect(nudgesOf(rig)).toEqual([])
  })

  it('leaves a crash interruption to nudge the model back into the thought', async () => {
    // A crash ends the run without the operator's stop reason, so the reply is interrupted but
    // not marked stopped: that reply is what resume() nudges the model back into.
    const { rig, stop } = stoppedRig('crash')
    await stop()

    const reply = rig.record.eventsOf(THREAD).find((event) => event.type === 'assistant-said')
    expect(reply?.type === 'assistant-said' ? reply.interrupted : undefined).toBe(true)
    expect(reply?.type === 'assistant-said' ? reply.stopped : undefined).toBeUndefined()

    await rig.runner.resume({ threadId: THREAD })

    const [nudge] = nudgesOf(rig)
    expect(nudge?.type === 'nudge' ? nudge.text : '').toBe(RESUME_NUDGE)
  })

  it('hands the stopped prose back to the model on the next turn', async () => {
    const { rig, stop } = stoppedRig()
    await stop()
    const stopped = textsOf(rig).join('')

    await rig.runner.say({ threadId: THREAD, text: 'go on' })

    const replayed = rig.model.requests[1]?.assembled.messages
    expect(stopped).not.toBe('')
    expect(JSON.stringify(replayed)).toContain(stopped)
  })
})
