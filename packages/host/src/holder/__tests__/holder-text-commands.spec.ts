import { describe, expect, it } from 'bun:test'

import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { composeCommands } from '@dltech/atlas-commands'
import { ECompactionAnchor, EInputConsumed, visibleEvents, type V2Event } from '@dltech/atlas-core'
import {
  nativeCommandHandlers,
  nativeCommands,
  REFUSAL_REWIND_NEEDS_LINE,
} from '@dltech/atlas-native-commands'

import { flushUntil, makeRig, seedSession, THREAD_ID } from './holder-rig'

type Rig = Awaited<ReturnType<typeof makeRig>>

const eventsOf = async (rig: Rig): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const typesOf = async (rig: Rig): Promise<string[]> =>
  (await eventsOf(rig)).map((event) => event.type)

const recordedSaidTexts = (events: readonly V2Event[]): string[] =>
  events.flatMap((event) => (event.type === 'user-said' ? [event.text] : []))

const saidTexts = (events: readonly V2Event[]): string[] =>
  visibleEvents(events).flatMap((event) => (event.type === 'user-said' ? [event.text] : []))

const rigWithConversation = async (lastStep: { text: string }): Promise<Rig> => {
  const model = new ScriptedModel([{ text: 'one' }, { text: 'two' }, lastStep])
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

const posted = async (rig: Rig, text: string) => {
  const entry = await rig.post(text)
  await rig.wake()
  return entry
}

describe('SessionHolder text commands', () => {
  it('summarises up to the last message when /summarise is typed while idle', async () => {
    const rig = await rigWithConversation({ text: 'the notes' })
    const said = (await eventsOf(rig)).filter((event) => event.type === 'user-said')
    const last = said.at(-1)
    if (last === undefined) throw new Error('no last message')
    const entry = await posted(rig, '/summarise')
    expect(
      await flushUntil({ check: async () => (await typesOf(rig)).includes('history-summarised') }),
    ).toBe(true)
    const events = await eventsOf(rig)
    expect(events.find((event) => event.type === 'history-summarised')).toMatchObject({
      fromSeq: said[0]?.seq,
      throughSeq: last.seq - 1,
      anchor: ECompactionAnchor.Prefix,
      summary: 'the notes',
      inboxId: entry.inboxId,
    })
    const consumed = events.find(
      (event) => event.type === 'input-consumed' && event.inboxId === entry.inboxId,
    )
    expect(consumed).toMatchObject({
      consumed: EInputConsumed.Command,
      command: { name: 'summarise', argumentText: '', text: '/summarise' },
    })
    expect(recordedSaidTexts(events)).toEqual(['first', 'second'])
  })

  it('refuses a bare /rewind with the picker sentence and records no message', async () => {
    const rig = await rigWithConversation({ text: 'unused' })
    const entry = await posted(rig, '/rewind')
    expect(
      await flushUntil({ check: async () => (await typesOf(rig)).includes('input-refused') }),
    ).toBe(true)
    const events = await eventsOf(rig)
    expect(events.find((event) => event.type === 'input-refused')).toMatchObject({
      inboxId: entry.inboxId,
      reason: REFUSAL_REWIND_NEEDS_LINE,
    })
    expect(events.some((event) => event.type === 'history-rewound')).toBe(false)
    expect(recordedSaidTexts(events)).toEqual(['first', 'second'])
  })

  it('rewinds to the message that /rewind names', async () => {
    const rig = await rigWithConversation({ text: 'unused' })
    const said = (await eventsOf(rig)).filter((event) => event.type === 'user-said')
    const target = said[1]
    if (target === undefined) throw new Error('no second message')
    const entry = await posted(rig, `/rewind ${target.seq}`)
    expect(
      await flushUntil({ check: async () => (await typesOf(rig)).includes('history-rewound') }),
    ).toBe(true)
    const events = await eventsOf(rig)
    expect(events.find((event) => event.type === 'history-rewound')).toMatchObject({
      toSeq: target.seq - 1,
      draft: 'second',
      inboxId: entry.inboxId,
    })
    expect(saidTexts(events)).toEqual(['first'])
  })
})
