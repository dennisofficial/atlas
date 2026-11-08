import { describe, expect, it } from 'bun:test'

import { composeCommands, defineCommand, type CommandHandler } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming, EInputConsumed, type V2Event } from '@dltech/atlas-core'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const ping = defineCommand({
  spec: {
    name: 'ping',
    summary: 'records a fact',
    group: ECommandGroup.Session,
    args: z.strictObject({ word: z.string() }),
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})

const handlerOf = (result: 'done' | string): CommandHandler<unknown> => {
  return async ({ args, append }) => {
    if (result !== 'done') return { kind: 'refused', reason: result }
    const { word } = args as { word: string }
    await append([{ type: 'fact-recorded', key: 'ping', kind: 'test', value: word }])
    return { kind: 'done' }
  }
}

const eventsOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const typesOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string[]> =>
  (await eventsOf(rig)).map((event) => event.type)

const rigWith = async (result: 'done' | string) => {
  const rig = await makeRig({
    commands: composeCommands([ping]),
    commandHandlers: new Map([[ping.inboxKind, handlerOf(result)]]),
  })
  await seedSession(rig)
  await rig.holder.start()
  return rig
}

const postPing = (rig: Awaited<ReturnType<typeof makeRig>>, payload: string) =>
  rig.plane.post({ sessionId: SESSION, kind: ping.inboxKind, payload })

describe('SessionHolder command intake', () => {
  it('consumes a command then lets the handler append its own event, without waking a turn', async () => {
    const rig = await rigWith('done')
    await postPing(rig, '{"word":"hi"}')
    await rig.wake()
    const settled = await flushUntil({
      check: async () => (await typesOf(rig)).includes('fact-recorded'),
    })
    expect(settled).toBe(true)
    const events = await eventsOf(rig)
    const consumed = events.findIndex(
      (event) => event.type === 'input-consumed' && event.consumed === EInputConsumed.Command,
    )
    const fact = events.findIndex((event) => event.type === 'fact-recorded')
    expect(consumed).toBeGreaterThanOrEqual(0)
    expect(fact).toBeGreaterThan(consumed)
    expect(events.some((event) => event.type === 'input-refused')).toBe(false)
    expect(rig.runCount()).toBe(0)
  })

  it('records input-refused after input-consumed when the handler refuses', async () => {
    const rig = await rigWith('not now')
    const posted = await postPing(rig, '{"word":"hi"}')
    await rig.wake()
    const refused = await flushUntil({
      check: async () => (await typesOf(rig)).includes('input-refused'),
    })
    expect(refused).toBe(true)
    const events = await eventsOf(rig)
    const types = events.map((event) => event.type)
    expect(types.indexOf('input-refused')).toBeGreaterThan(types.indexOf('input-consumed'))
    expect(events.find((event) => event.type === 'input-refused')).toMatchObject({
      inboxId: posted.inboxId,
      reason: 'not now',
    })
    expect(rig.runCount()).toBe(0)
  })

  it('refuses a payload that does not parse with the zod message', async () => {
    const rig = await rigWith('done')
    await postPing(rig, '{"word":1}')
    await rig.wake()
    const refused = await flushUntil({
      check: async () => (await typesOf(rig)).includes('input-refused'),
    })
    expect(refused).toBe(true)
    const event = (await eventsOf(rig)).find((kept) => kept.type === 'input-refused')
    expect(event).toMatchObject({ reason: expect.stringContaining('word') })
    expect((await typesOf(rig)).includes('fact-recorded')).toBe(false)
  })

  it('leaves a command kind with no handler in the inbox and starts no turn', async () => {
    const rig = await makeRig({
      commands: composeCommands([ping]),
      commandHandlers: new Map([[ping.inboxKind, handlerOf('done')]]),
    })
    await seedSession(rig)
    await rig.holder.start()
    const ghost = await rig.plane.post({ sessionId: SESSION, kind: 'command:ghost', payload: '{}' })
    await postPing(rig, '{"word":"hi"}')
    await rig.wake()
    const settled = await flushUntil({
      check: async () => (await typesOf(rig)).includes('fact-recorded'),
    })
    expect(settled).toBe(true)
    await rig.flush()
    const consumed = (await eventsOf(rig)).flatMap((event) =>
      event.type === 'input-consumed' ? [event] : [],
    )
    expect(consumed.map((event) => event.inboxId)).not.toContain(ghost.inboxId)
    const inbox = await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })
    expect(inbox.map((entry) => entry.inboxId)).toContain(ghost.inboxId)
    expect(rig.runCount()).toBe(0)
  })

  it('does not start an empty turn when the only input is an unresolvable command', async () => {
    const rig = await makeRig({ commands: composeCommands([ping]) })
    await seedSession(rig)
    await rig.holder.start()
    await rig.plane.post({ sessionId: SESSION, kind: 'command:ghost', payload: '{}' })
    await rig.wake()
    await rig.flush()
    await rig.wake()
    await rig.flush()
    expect(rig.runCount()).toBe(0)
    expect(await typesOf(rig)).not.toContain('input-consumed')
    const inbox = await rig.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })
    expect(inbox).toHaveLength(1)
  })

  it('runs a command kind for a holder that knows it', async () => {
    const rig = await rigWith('done')
    await postPing(rig, '{"word":"known"}')
    await rig.wake()
    const settled = await flushUntil({
      check: async () => (await typesOf(rig)).includes('fact-recorded'),
    })
    expect(settled).toBe(true)
  })

  it('leaves a command posted during a turn until the turn settles', async () => {
    const rig = await makeRig({
      script: [
        {
          calls: [{ callId: 'call-1', name: 'bash', input: { command: 'sleep 0.3; echo done' } }],
        },
        { text: 'finished' },
      ],
      commands: composeCommands([ping]),
      commandHandlers: new Map([[ping.inboxKind, handlerOf('done')]]),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    await flushUntil({
      check: async () => (await typesOf(rig)).includes('tool-dispatched'),
    })
    await postPing(rig, '{"word":"late"}')
    await rig.wake()
    expect((await typesOf(rig)).includes('fact-recorded')).toBe(false)
    const settled = await flushUntil({
      check: async () => (await typesOf(rig)).includes('fact-recorded'),
      attempts: 1500,
    })
    expect(settled).toBe(true)
    const types = await typesOf(rig)
    expect(types.indexOf('fact-recorded')).toBeGreaterThan(types.indexOf('assistant-said'))
  })
})
