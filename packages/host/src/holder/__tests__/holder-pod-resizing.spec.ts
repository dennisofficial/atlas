import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EPodResizeNotice,
  INBOX_KIND_RECORD,
  inboxEventPayloadOf,
  type V2Event,
} from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const fullLog = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> => {
  const events: V2Event[] = []
  let afterSeq = 0
  for (;;) {
    const page = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq,
      limit: 1000,
      visible: false,
    })
    events.push(...page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}

const started = {
  type: 'pod-resize-started' as const,
  vcpus: 16,
  memoryGb: 64,
  generation: 3,
}

const resized = {
  type: 'pod-resized' as const,
  vcpus: 16,
  memoryGb: 64,
  generation: 3,
  outcome: EPodResizeNotice.Applied,
}

describe('SessionHolder pod resize', () => {
  it('interrupts the running bash, consumes the resize and lets the turn continue', async () => {
    const rig = await makeRig({
      script: [
        {
          calls: [
            {
              callId: 'call-1',
              name: 'bash',
              input: { command: 'echo started; sleep 600; echo late' },
            },
          ],
        },
        { text: 'carrying on after the resize' },
      ],
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('long exec')
    await rig.wake()
    const dispatched = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)

    const posted = await rig.plane.post({
      sessionId: SESSION,
      kind: INBOX_KIND_RECORD,
      payload: inboxEventPayloadOf({ event: started, clientId: 'pod-resize-started:3' }),
    })
    await rig.wake()
    await rig.flush()

    const interrupted = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-result'),
      attempts: 200,
      clock: rig.clock,
      advanceMs: 2_000,
    })
    expect(interrupted).toBe(true)

    const log = await fullLog(rig)
    const result = log.find((event) => event.type === 'tool-result')
    if (result?.type !== 'tool-result') throw new Error('no tool-result')
    expect(result.error?.message).toContain('being resized to 16 vCPU / 64 GB')
    expect(
      log.some((event) => event.type === 'input-consumed' && event.inboxId === posted.inboxId),
    ).toBe(true)
    expect(log.some((event) => event.type === 'pod-resize-started')).toBe(true)
    expect(
      log.some((event) => event.type === 'agent-ended' && event.status === EAgentStatus.Failed),
    ).toBe(false)
    expect(await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
  }, 30_000)

  it('does not start a turn on an idle session and shows the notice in the next prompt', async () => {
    const model = new ScriptedModel([{ text: 'noted' }])
    const rig = await makeRig({ model: () => model })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    await rig.flush()

    await rig.plane.post({
      sessionId: SESSION,
      kind: INBOX_KIND_RECORD,
      payload: inboxEventPayloadOf({ event: resized, clientId: 'pod-resized:3' }),
    })
    await rig.wake()
    await rig.flush()

    expect(model.requests).toHaveLength(0)
    expect((await rig.events()).some((event) => event.type === 'assistant-said')).toBe(false)

    await rig.post('carry on')
    await rig.wake()
    const answered = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      attempts: 400,
    })
    expect(answered).toBe(true)
    expect(JSON.stringify(model.requests.at(-1)?.assembled.messages)).toContain(
      'The pod was resized to 16 vCPU / 64 GB of memory.',
    )
    rig.holder.discard()
  }, 20_000)
})
