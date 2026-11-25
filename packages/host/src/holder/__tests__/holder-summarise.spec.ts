import { describe, expect, it } from 'bun:test'

import { composeCommands } from '@dltech/atlas-commands'
import { ECompactionAnchor, EInputConsumed, type RecordEvent } from '@dltech/atlas-core'
import { nativeCommandHandlers, nativeCommands } from '@dltech/atlas-native-commands'
import { ScriptedModel } from '@dltech/atlas-agent/testing'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

type Rig = Awaited<ReturnType<typeof makeRig>>

const eventsOf = async (rig: Rig): Promise<RecordEvent[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const typesOf = async (rig: Rig): Promise<string[]> =>
  (await eventsOf(rig)).map((event) => event.type)

const rigWithConversation = async (summaryStep: { text: string }): Promise<Rig> => {
  const model = new ScriptedModel([{ text: 'one' }, { text: 'two' }, summaryStep])
  const rig = await makeRig({
    model: () => model,
    commands: composeCommands(nativeCommands),
    commandHandlers: nativeCommandHandlers,
  })
  await seedSession(rig)
  await rig.holder.start()
  for (const [index, text] of ['first', 'second'].entries()) {
    await rig.post(text)
    await rig.wake()
    await flushUntil({
      check: async () =>
        (await typesOf(rig)).filter((type) => type === 'assistant-said').length === index + 1,
    })
  }
  return rig
}

const postSummarise = async (rig: Rig, throughSeq: number) => {
  const posted = await rig.plane.post({
    sessionId: SESSION,
    kind: 'command:summarise',
    payload: JSON.stringify({ throughSeq }),
  })
  await rig.wake()
  return posted
}

const secondMessageSeq = async (rig: Rig): Promise<number> => {
  const said = (await eventsOf(rig)).filter((event) => event.type === 'user-said')
  const target = said[1]
  if (target === undefined) throw new Error('no second message')
  return target.seq
}

describe('SessionHolder summarise command', () => {
  it('records input-consumed then history-summarised with the model text', async () => {
    const rig = await rigWithConversation({ text: 'the notes' })
    const through = (await secondMessageSeq(rig)) - 1
    const first = (await eventsOf(rig)).find((event) => event.type === 'user-said')
    const posted = await postSummarise(rig, through)
    expect(
      await flushUntil({ check: async () => (await typesOf(rig)).includes('history-summarised') }),
    ).toBe(true)
    const events = await eventsOf(rig)
    const summarised = events.find((event) => event.type === 'history-summarised')
    expect(summarised).toMatchObject({
      fromSeq: first?.seq,
      throughSeq: through,
      anchor: ECompactionAnchor.Prefix,
      summary: 'the notes',
      inboxId: posted.inboxId,
    })
    const consumed = events.findLast(
      (event) => event.type === 'input-consumed' && event.consumed === EInputConsumed.Command,
    )
    expect(consumed?.seq ?? Number.MAX_SAFE_INTEGER).toBeLessThan(summarised?.seq ?? 0)
    expect(events.some((event) => event.type === 'input-refused')).toBe(false)
  })

  it('posts the command into the log before it is consumed, once', async () => {
    const rig = await rigWithConversation({ text: 'the notes' })
    const through = (await secondMessageSeq(rig)) - 1
    const posted = await postSummarise(rig, through)
    expect(
      await flushUntil({ check: async () => (await typesOf(rig)).includes('history-summarised') }),
    ).toBe(true)
    await rig.wake()
    await rig.flush()
    const events = await eventsOf(rig)
    const posts = events.filter(
      (event) => event.type === 'input-posted' && event.inboxId === posted.inboxId,
    )
    expect(posts).toHaveLength(1)
    const consumed = events.find(
      (event) => event.type === 'input-consumed' && event.inboxId === posted.inboxId,
    )
    expect(posts[0]?.seq ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
      consumed?.seq ?? Number.MIN_SAFE_INTEGER,
    )
  })

  it('records input-refused when the model returns nothing', async () => {
    const rig = await rigWithConversation({ text: '' })
    const through = (await secondMessageSeq(rig)) - 1
    const posted = await postSummarise(rig, through)
    expect(
      await flushUntil({ check: async () => (await typesOf(rig)).includes('input-refused') }),
    ).toBe(true)
    const events = await eventsOf(rig)
    expect(events.find((event) => event.type === 'input-refused')).toMatchObject({
      inboxId: posted.inboxId,
      reason: 'The summary came back empty',
    })
    expect(events.some((event) => event.type === 'history-summarised')).toBe(false)
  })

  it('records input-refused when the target is not a message boundary', async () => {
    const rig = await rigWithConversation({ text: 'unused' })
    const first = (await eventsOf(rig)).find((event) => event.type === 'user-said')
    await postSummarise(rig, first?.seq ?? 0)
    const got = await flushUntil({
      check: async () => (await typesOf(rig)).includes('input-refused'),
    })
    expect(got).toBe(true)
    expect((await eventsOf(rig)).find((event) => event.type === 'input-refused')).toMatchObject({
      reason: 'That message cannot be summarised',
    })
  })
})
