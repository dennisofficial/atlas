import { describe, expect, it } from 'bun:test'

import { composeCommands, defineCommand, type CommandHandler } from '@dltech/atlas-commands'
import {
  chainEvents,
  ECommandGroup,
  ECommandTiming,
  ECompactionAnchor,
  EInputConsumed,
  toRunId,
  toThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

type Rig = Awaited<ReturnType<typeof makeRig>>

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

const handler: CommandHandler<unknown> = async ({ args, append }) => {
  const { word } = args as { word: string }
  await append([{ type: 'fact-recorded', key: 'ping', kind: 'test', value: word }])
  return { kind: 'done' }
}

const eventsOf = async (rig: Rig): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const typesOf = async (rig: Rig): Promise<string[]> =>
  (await eventsOf(rig)).map((event) => event.type)

const consumed = (inboxId: number): V2Body => ({
  type: 'input-consumed',
  inboxId,
  consumed: EInputConsumed.Command,
})

const summarised = (inboxId: number): V2Body => ({
  type: 'history-summarised',
  fromSeq: 1,
  throughSeq: 1,
  anchor: ECompactionAnchor.Prefix,
  summary: 's',
  inboxId,
})

const deadHolderLeft = async (args: {
  rig: Rig
  payload?: string
  after?: (inboxId: number) => V2Body[]
}): Promise<void> => {
  const { rig } = args
  await seedSession(rig)
  const posted = await rig.plane.post({
    sessionId: SESSION,
    kind: ping.inboxKind,
    payload: args.payload ?? '{"word":"hi"}',
  })
  const { epoch } = await rig.plane.grant({ sessionId: SESSION, hostId: 9001 })
  const outcome = await rig.plane.append({
    threadId: THREAD_ID,
    epoch,
    events: chainEvents({
      threadId: toThreadId(THREAD_ID),
      runId: toRunId('dead-run'),
      epoch,
      at: new Date(0).toISOString(),
      bodies: [
        { type: 'workspace-prepared' },
        consumed(posted.inboxId),
        ...(args.after?.(posted.inboxId) ?? []),
      ],
      from: await rig.plane.head({ threadId: THREAD_ID }),
    }),
  })
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: true })
}

const rigWithPing = (): Promise<Rig> =>
  makeRig({
    commands: composeCommands([ping]),
    commandHandlers: new Map([[ping.inboxKind, handler]]),
  })

const takeOver = async (rig: Rig): Promise<void> => {
  await rig.holder.start()
  await rig.wake()
  await flushUntil({ check: async () => rig.runtimes.length > 0 })
  await rig.flush()
}

describe('SessionHolder command recovery', () => {
  it('replays a consumed command whose holder died, once, without a second input-consumed', async () => {
    const rig = await rigWithPing()
    await deadHolderLeft({ rig })
    await takeOver(rig)
    const replayed = await flushUntil({
      check: async () => (await typesOf(rig)).includes('fact-recorded'),
    })
    expect(replayed).toBe(true)
    await rig.wake()
    await rig.flush()
    const types = await typesOf(rig)
    expect(types.filter((type) => type === 'fact-recorded')).toHaveLength(1)
    expect(types.filter((type) => type === 'input-consumed')).toHaveLength(1)
    expect(rig.runCount()).toBe(0)
  })

  it('does not replay a command that an outcome already names', async () => {
    const rig = await rigWithPing()
    await deadHolderLeft({ rig, after: (inboxId) => [summarised(inboxId)] })
    await takeOver(rig)
    await rig.wake()
    await rig.flush()
    expect(await typesOf(rig)).not.toContain('fact-recorded')
  })

  it('does not replay a command whose payload was refused', async () => {
    const rig = await rigWithPing()
    await deadHolderLeft({
      rig,
      after: (inboxId) => [{ type: 'input-refused', inboxId, reason: 'no' }],
    })
    await takeOver(rig)
    await rig.flush()
    expect(await typesOf(rig)).not.toContain('fact-recorded')
  })

  it('appends nothing when the tail has no unfinished command', async () => {
    const rig = await rigWithPing()
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    await flushUntil({ check: async () => (await typesOf(rig)).includes('workspace-prepared') })
    await rig.flush()
    expect(await typesOf(rig)).toEqual(['workspace-prepared'])
  })

  it('logs and keeps the session alive when the replay throws', async () => {
    const rig = await makeRig({
      commands: composeCommands([ping]),
      commandHandlers: new Map([
        [
          ping.inboxKind,
          async () => {
            throw new Error('boom')
          },
        ],
      ]),
    })
    await deadHolderLeft({ rig })
    await takeOver(rig)
    await rig.post('hello')
    await rig.wake()
    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
    })
    expect(answered).toBe(true)
  })
})
