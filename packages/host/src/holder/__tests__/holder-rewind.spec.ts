import { describe, expect, it } from 'bun:test'

import { composeCommands } from '@dltech/atlas-commands'
import { EInputConsumed, visibleEvents, type V2Event } from '@dltech/atlas-core'
import { nativeCommandHandlers, nativeCommands } from '@dltech/atlas-native-commands'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

type Rig = Awaited<ReturnType<typeof makeRig>>

const eventsOf = async (rig: Rig): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const typesOf = async (rig: Rig): Promise<string[]> =>
  (await eventsOf(rig)).map((event) => event.type)

const rigWithConversation = async (): Promise<Rig> => {
  const rig = await makeRig({
    script: [{ text: 'one' }, { text: 'two' }],
    commands: composeCommands(nativeCommands),
    commandHandlers: nativeCommandHandlers,
  })
  await seedSession(rig)
  await rig.holder.start()
  await rig.post('first')
  await rig.wake()
  await flushUntil({
    check: async () => (await typesOf(rig)).filter((t) => t === 'assistant-said').length === 1,
  })
  await rig.post('second')
  await rig.wake()
  await flushUntil({
    check: async () => (await typesOf(rig)).filter((t) => t === 'assistant-said').length === 2,
  })
  return rig
}

const postRewind = async (rig: Rig, payload: string) => {
  const posted = await rig.plane.post({ sessionId: SESSION, kind: 'command:rewind', payload })
  await rig.wake()
  return posted
}

describe('SessionHolder rewind command', () => {
  it('records input-consumed then history-rewound with the message text as the draft', async () => {
    const rig = await rigWithConversation()
    const said = (await eventsOf(rig)).filter((event) => event.type === 'user-said')
    const target = said[1]
    if (target === undefined) throw new Error('no second message')
    const posted = await postRewind(rig, JSON.stringify({ toSeq: target.seq }))
    expect(
      await flushUntil({ check: async () => (await typesOf(rig)).includes('history-rewound') }),
    ).toBe(true)
    const events = await eventsOf(rig)
    const rewound = events.find((event) => event.type === 'history-rewound')
    expect(rewound).toMatchObject({
      toSeq: target.seq - 1,
      draft: 'second',
      inboxId: posted.inboxId,
    })
    const consumed = events.findLast(
      (event) => event.type === 'input-consumed' && event.consumed === EInputConsumed.Command,
    )
    expect(consumed === undefined ? -1 : consumed.seq).toBeLessThan(rewound?.seq ?? 0)
    const visibleTexts = visibleEvents(events).flatMap((event) =>
      event.type === 'user-said' ? [event.text] : [],
    )
    expect(visibleTexts).toEqual(['first'])
  })

  it('refuses a sequence that is not a user message', async () => {
    const rig = await rigWithConversation()
    const reply = (await eventsOf(rig)).find((event) => event.type === 'assistant-said')
    if (reply === undefined) throw new Error('no reply')
    await postRewind(rig, JSON.stringify({ toSeq: reply.seq }))
    expect(
      await flushUntil({ check: async () => (await typesOf(rig)).includes('input-refused') }),
    ).toBe(true)
    const events = await eventsOf(rig)
    expect(events.find((event) => event.type === 'input-refused')).toMatchObject({
      reason: 'Only one of your messages can be rewound to',
    })
    expect(events.some((event) => event.type === 'history-rewound')).toBe(false)
  })
})
