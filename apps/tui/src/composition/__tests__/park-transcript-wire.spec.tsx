import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'

import {
  EChannelConnection,
  eventLogFile,
  EServeFrame,
  SessionRegistry,
} from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { until } from './app-fixture'
import { cleanup, entryOpacities, rig } from './park-transcript-wire-rig'

await grammarsReady()

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

describe('the final park over a real websocket and a real session directory', () => {
  it('applies the parked tail that lands on disk after the socket parked, with no further wire traffic', async () => {
    const held = await rig()
    held.authoritative.push(held.parked)
    held.serve.push({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'events-appended' } })
    await held.entered.gate

    await held.refresh.refresh()
    expect(held.visible().map((event) => event.type)).toEqual(['user-said'])

    held.serve.push({ kind: EServeFrame.Parked, reason: 'idle', checkpoint: held.checkpoint })
    expect(await until({
      holds: async () => held.channel.connection().state === EChannelConnection.Parked,
      within: 5000,
    })).toBe(true)
    expect(held.session.health().stale).toBe(true)
    const mutedBefore = await entryOpacities({ store: held.store, stale: held.session.health().stale })
    expect(mutedBefore.length).toBeGreaterThan(0)
    expect(mutedBefore.every((opacity) => opacity === 0.4)).toBe(true)

    const framesAtPark = held.serve.sent.length
    held.finish.release()

    expect(await until({
      holds: async () => held.visible().at(-1)?.type === 'parked' && !held.session.health().stale,
      within: 5000,
    })).toBe(true)
    expect(held.readiness.applied()?.identity).toEqual(held.checkpoint.transcript)
    expect(await until({
      holds: async () => (await held.threads.readParkedTranscript({ threadId: held.threadId }))?.applied != null,
      within: 5000,
    })).toBe(true)
    expect((await held.threads.readParkedTranscript({ threadId: held.threadId }))?.applied)
      .toEqual(held.checkpoint.transcript)

    const file = await readFile(eventLogFile({
      sessionDir: await new SessionRegistry(held.home).sessionDirFor({ threadId: held.threadId }),
      threadId: held.threadId,
    }), 'utf8')
    expect(file.trim().split('\n').map((line) => (JSON.parse(line) as { type: string }).type))
      .toEqual(['user-said', 'parked'])

    expect(held.serve.sent.length).toBe(framesAtPark)
    expect(held.serve.upgrades()).toBe(1)
    expect(held.channel.connection().state).toBe(EChannelConnection.Parked)
    const painted = await entryOpacities({ store: held.store, stale: held.session.health().stale })
    expect(painted.length).toBeGreaterThan(0)
    expect(painted.every((opacity) => opacity === 1)).toBe(true)
  }, 15_000)

  it('holds the park record pending while the writer is gated, then records the applied identity once released inside the wait', async () => {
    const held = await rig()
    held.authoritative.push(held.parked)
    held.serve.push({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'events-appended' } })
    await held.entered.gate
    held.serve.push({ kind: EServeFrame.Parked, reason: 'idle', checkpoint: held.checkpoint })
    expect(await until({
      holds: async () => held.channel.connection().state === EChannelConnection.Parked,
      within: 5000,
    })).toBe(true)

    await held.waiting.gate
    expect(await held.threads.readParkedTranscript({ threadId: held.threadId })).toBeNull()
    expect(held.visible().map((event) => event.type)).toEqual(['user-said'])
    expect(held.session.health().stale).toBe(true)

    held.finish.release()

    expect(await until({
      holds: async () => (await held.threads.readParkedTranscript({ threadId: held.threadId })) !== null,
      within: 4000,
    })).toBe(true)
    const record = await held.threads.readParkedTranscript({ threadId: held.threadId })
    expect(record?.checkpoint).toEqual(held.checkpoint)
    expect(record?.applied).toEqual(held.checkpoint.transcript)
    expect(held.visible().at(-1)?.type).toBe('parked')
    expect(held.session.health().stale).toBe(false)
  }, 15_000)
})
