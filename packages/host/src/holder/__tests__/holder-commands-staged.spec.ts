import { describe, expect, it } from 'bun:test'

import { composeCommands, defineCommand, type CommandHandler } from '@dltech/atlas-commands'
import {
  chainEvents,
  ECommandGroup,
  ECommandTiming,
  toRunId,
  toThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const listen = defineCommand({
  spec: {
    name: 'listen',
    summary: 'records a fact at once',
    group: ECommandGroup.Session,
    args: z.strictObject({ word: z.string() }),
    timing: ECommandTiming.Immediate,
    handledIn: 'holder',
  },
})

const handler: CommandHandler<unknown> = async ({ args, append }) => {
  const { word } = args as { word: string }
  await append([{ type: 'fact-recorded', key: 'listen', kind: 'test', value: word }])
  return { kind: 'done' }
}

const slowTurn: readonly ScriptedModelStep[] = [
  { calls: [{ callId: 'call-1', name: 'bash', input: { command: 'sleep 0.4; echo done' } }] },
  { text: 'finished' },
]

const rigOf = (): Promise<HolderRig> =>
  makeRig({
    script: slowTurn,
    commands: composeCommands([listen]),
    commandHandlers: new Map([[listen.inboxKind, handler]]),
  })

const eventsOf = async (rig: HolderRig): Promise<V2Event[]> =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 500, visible: false }))
    .events

const typesOf = async (rig: HolderRig): Promise<string[]> =>
  (await eventsOf(rig)).map((event) => event.type)

const midTool = (rig: HolderRig): Promise<boolean> =>
  flushUntil({
    check: async () => (await typesOf(rig)).includes('tool-dispatched'),
    attempts: 2000,
  })

const hideOnceFromSnapshot = (args: { rig: HolderRig; inboxId: number }): void => {
  const original = args.rig.plane.readInbox.bind(args.rig.plane)
  let armed = true
  args.rig.plane.readInbox = async (params) => {
    const entries = await original(params)
    if (!armed || (params.forThread ?? null) !== null) return entries
    armed = false
    return entries.filter((entry) => entry.inboxId !== args.inboxId)
  }
}

const stageIntoLog = async (args: { rig: HolderRig; inboxId: number }): Promise<void> => {
  const entry = await args.rig.plane.readInboxEntry({
    sessionId: SESSION,
    inboxId: args.inboxId,
  })
  if (entry === undefined) throw new Error('the posted command has no inbox row')
  const stale = await eventsOf(args.rig)
  const epoch = stale.at(-1)?.epoch ?? 1
  const bodies: V2Body[] = [
    { type: 'input-posted', inboxId: entry.inboxId, kind: entry.kind, postedAt: entry.postedAt },
  ]
  const outcome = await args.rig.plane.append({
    threadId: THREAD_ID,
    epoch,
    events: chainEvents({
      threadId: toThreadId(THREAD_ID),
      runId: toRunId('dead-run'),
      epoch,
      at: new Date(0).toISOString(),
      bodies,
      from: await args.rig.plane.head({ threadId: THREAD_ID }),
    }),
  })
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
}

const countsOf = (types: readonly string[], type: string): number =>
  types.filter((seen) => seen === type).length

describe('an immediate command staged into the log only', () => {
  it('runs a command logged after the inbox snapshot, once, before the turn ends', async () => {
    const rig = await rigOf()
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    expect(await midTool(rig)).toBe(true)
    const posted = await rig.plane.post({
      sessionId: SESSION,
      kind: listen.inboxKind,
      payload: '{"word":"mid"}',
    })
    hideOnceFromSnapshot({ rig, inboxId: posted.inboxId })
    await rig.wake()
    const ran = await flushUntil({
      check: async () => {
        const types = await typesOf(rig)
        return types.includes('fact-recorded') && types.includes('assistant-said')
      },
      attempts: 2500,
    })
    expect(ran).toBe(true)
    const types = await typesOf(rig)
    expect(types).toContain('input-posted')
    expect(types.indexOf('fact-recorded')).toBeLessThan(types.indexOf('tool-result'))
    expect(countsOf(types, 'fact-recorded')).toBe(1)
    expect(countsOf(types, 'input-consumed')).toBe(1)
    expect(rig.runCount()).toBe(1)
  }, 20_000)

  it('runs a logged pending command once a new holder takes the session over', async () => {
    const a = await rigOf()
    await seedSession(a)
    await a.holder.start()
    await a.post('go')
    await a.wake()
    expect(await midTool(a)).toBe(true)
    const crashedAt = (await eventsOf(a)).at(-1)?.epoch ?? 1
    const posted = await a.plane.post({
      sessionId: SESSION,
      kind: listen.inboxKind,
      payload: '{"word":"after-crash"}',
    })
    await stageIntoLog({ rig: a, inboxId: posted.inboxId })
    await a.holder.discard()
    a.presence.lose()
    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'recovered' }],
      commands: composeCommands([listen]),
      commandHandlers: new Map([[listen.inboxKind, handler]]),
    })
    await b.holder.start()
    await b.wake()
    const ran = await flushUntil({
      check: async () => {
        const types = await typesOf(b)
        return types.includes('fact-recorded') && types.includes('assistant-said')
      },
      clock: a.clock,
      attempts: 3000,
      advanceMs: 1_000,
    })
    expect(ran).toBe(true)
    const events = await eventsOf(b)
    const types = events.map((event) => event.type)
    expect(countsOf(types, 'fact-recorded')).toBe(1)
    expect(countsOf(types, 'input-consumed')).toBe(1)
    expect(types.indexOf('input-consumed')).toBeLessThan(types.indexOf('fact-recorded'))
    const fact = events.find((event) => event.type === 'fact-recorded')
    expect(fact?.epoch).toBeGreaterThan(crashedAt)
  }, 20_000)
})
