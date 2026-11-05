import { describe, expect, it } from 'bun:test'

import type { V2Event } from '@dltech/atlas-core'
import { INBOX_KIND_REPAIR_DIAGRAM } from '@dltech/atlas-protocol'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const BROKEN = 'graph TD\n  A[Say "hi"; bye] --> B'
const FIXED = 'graph TD\n  A["Say hi; bye"] --> B'

const setup = async (script: readonly ScriptedModelStep[]) => {
  const model = new ScriptedModel(script, { id: 'scripted', modelId: 'runtime-model-7' })
  const rig = await makeRig({ model: () => model })
  await seedSession(rig)
  await rig.holder.start()
  return { rig, model }
}

const postRepair = (rig: Awaited<ReturnType<typeof makeRig>>) =>
  rig.plane.post({
    sessionId: SESSION,
    kind: INBOX_KIND_REPAIR_DIAGRAM,
    payload: JSON.stringify({ messageId: 'evt-9', source: BROKEN, error: 'Parse error' }),
  })

const fullLog = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1000,
    visible: false,
  })
  return page.events
}

const settled = (rig: Awaited<ReturnType<typeof makeRig>>) =>
  flushUntil({
    check: async () => (await rig.events()).some((event) => event.type === 'input-consumed'),
    attempts: 100,
  })

describe('SessionHolder diagram repair', () => {
  it('repairs from the inbox while idle: appends the repair then input-consumed, starts no turn', async () => {
    const { rig, model } = await setup([{ text: `\`\`\`mermaid\n${FIXED}\n\`\`\`` }])
    const { inboxId } = await postRepair(rig)
    await rig.wake()

    expect(await settled(rig)).toBe(true)
    const log = await fullLog(rig)
    const repaired = log.findIndex((event) => event.type === 'diagram-repaired')
    const consumed = log.findIndex((event) => event.type === 'input-consumed')
    expect(repaired).toBeGreaterThanOrEqual(0)
    expect(consumed).toBe(repaired + 1)
    const repair = log[repaired]
    if (repair?.type !== 'diagram-repaired') throw new Error('unreachable')
    expect(repair).toMatchObject({
      messageId: 'evt-9',
      original: BROKEN,
      repaired: FIXED,
      modelId: 'runtime-model-7',
    })
    const entry = log[consumed]
    expect(entry?.type === 'input-consumed' && entry.inboxId).toBe(inboxId)
    expect(log.some((event) => event.type === 'user-said' || event.type === 'assistant-said')).toBe(
      false,
    )
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools).toEqual([])
    expect(await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
  })

  it('a failed model call appends only input-consumed', async () => {
    const { rig } = await setup([{ throws: new Error('provider down') }])
    await postRepair(rig)
    await rig.wake()

    expect(await settled(rig)).toBe(true)
    const log = await fullLog(rig)
    expect(log.some((event) => event.type === 'diagram-repaired')).toBe(false)
    expect(log.filter((event) => event.type === 'input-consumed')).toHaveLength(1)
  })

  it('an empty or unchanged reply appends only input-consumed', async () => {
    const { rig } = await setup([{ text: BROKEN }])
    await postRepair(rig)
    await rig.wake()

    expect(await settled(rig)).toBe(true)
    expect((await fullLog(rig)).some((event) => event.type === 'diagram-repaired')).toBe(false)
  })

  it('a message posted alongside still wakes a turn and the repair does not', async () => {
    const { rig } = await setup([{ text: FIXED }, { text: 'hello back' }])
    await postRepair(rig)
    await rig.post('hello')
    await rig.wake()

    const answered = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
      attempts: 100,
    })
    expect(answered).toBe(true)
    const log = await fullLog(rig)
    expect(log.some((event) => event.type === 'diagram-repaired')).toBe(true)
    expect(log.filter((event) => event.type === 'user-said')).toHaveLength(1)
    expect(log.filter((event) => event.type === 'input-consumed')).toHaveLength(2)
  })

  it('mid-turn: the repair lands without disturbing the running turn', async () => {
    const { rig } = await setup([{ text: 'slow answer', streamMs: 400 }, { text: FIXED }])
    await rig.post('hello')
    await rig.wake()
    const started = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'user-said'),
      attempts: 100,
    })
    expect(started).toBe(true)

    await postRepair(rig)
    await rig.wake()
    const done = await flushUntil({
      check: async () => {
        const types = (await rig.events()).map((event) => event.type)
        return types.includes('assistant-said') && types.includes('diagram-repaired')
      },
      attempts: 3000,
    })
    expect(done).toBe(true)
    const log = await fullLog(rig)
    const answer = log.find((event) => event.type === 'assistant-said')
    expect(answer?.type === 'assistant-said' && answer.interrupted).not.toBe(true)
    expect(log.filter((event) => event.type === 'user-said')).toHaveLength(1)
    expect(log.filter((event) => event.type === 'input-consumed')).toHaveLength(2)
  })
})
