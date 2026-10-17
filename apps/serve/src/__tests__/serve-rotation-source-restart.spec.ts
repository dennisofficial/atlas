import { afterEach, describe, expect, it } from 'bun:test'

import { EClientFrame, EServeFrame, ETurnStatus, readSandboxRotationReceipt } from '@dltech/atlas-harness'

import { connect } from './client'
import { cleanupRotationFixtures, rotationFixture, sourceSession, threadId, token } from './serve-rotation-fixture'

afterEach(cleanupRotationFixtures)

describe('same-session restart over its own drain receipt', () => {
  it('reproduces the 2026-10-09 wedge: the hot-swapped serve accepts work instead of latching admission closed', async () => {
    const fixture = await rotationFixture()
    const boot = await fixture.boot({ sessionId: sourceSession })
    const handle = await boot.starting
    const client = await connect({ port: handle.port, token })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Run, resume: true })
    const ended = await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    expect(ended.kind === EServeFrame.TurnEnded && ended.outcome.status).toBe(ETurnStatus.Completed)
    expect(JSON.stringify(client.frames)).not.toContain('accepts no new work')
    client.close()
  }, 20_000)

  it('boots with the receipt consumed so a later same-session boot stays clean', async () => {
    const fixture = await rotationFixture()
    expect(await readSandboxRotationReceipt({ atlasHome: fixture.home })).not.toBeNull()
    const first = await fixture.boot({ sessionId: sourceSession })
    await first.starting
    expect(await readSandboxRotationReceipt({ atlasHome: fixture.home })).toBeNull()
    const second = await fixture.boot({ sessionId: sourceSession })
    const handle = await second.starting
    expect(await readSandboxRotationReceipt({ atlasHome: fixture.home })).toBeNull()
    const client = await connect({ port: handle.port, token })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Run, resume: true })
    const ended = await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    expect(ended.kind === EServeFrame.TurnEnded && ended.outcome.status).toBe(ETurnStatus.Completed)
    expect(JSON.stringify(client.frames)).not.toContain('accepts no new work')
    client.close()
  }, 20_000)
})
