import { afterEach, describe, expect, it } from 'bun:test'
import { access } from 'node:fs/promises'

import { EClientFrame, EServeFrame, readSandboxRotationState, sandboxRotationReceiptFile } from '@dltech/atlas-harness'

import { connect } from './client'
import { cleanupRotationFixtures, rotationFixture, sourceSession, threadId, token } from './serve-rotation-fixture'

afterEach(cleanupRotationFixtures)

const receiptExists = async (home: string): Promise<boolean> =>
  access(sandboxRotationReceiptFile({ atlasHome: home })).then(() => true, () => false)

describe('same-session restart over its own drain receipt', () => {
  it('reproduces the 2026-10-09 wedge: the hot-swapped serve accepts work instead of latching admission closed', async () => {
    const fixture = await rotationFixture()
    const boot = await fixture.boot({ sessionId: sourceSession })
    const handle = await boot.starting
    const client = await connect({ port: handle.port, token })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Run, resume: true })
    const reply = await client.waitFor((frame) =>
      frame.kind === EServeFrame.TurnStarted || frame.kind === EServeFrame.Error)
    expect(JSON.stringify(reply)).not.toContain('accepts no new work')
    client.close()
  }, 20_000)

  it('boots with the receipt consumed so a later same-session boot stays clean', async () => {
    const fixture = await rotationFixture()
    expect(await receiptExists(fixture.home)).toBe(true)
    const first = await fixture.boot({ sessionId: sourceSession })
    await first.starting
    expect(await receiptExists(fixture.home)).toBe(false)
    const second = await fixture.boot({ sessionId: sourceSession })
    const handle = await second.starting
    expect(await readSandboxRotationState({ atlasHome: fixture.home })).toBeNull()
    const client = await connect({ port: handle.port, token })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Run, resume: true })
    const reply = await client.waitFor((frame) =>
      frame.kind === EServeFrame.TurnStarted || frame.kind === EServeFrame.Error)
    expect(JSON.stringify(reply)).not.toContain('accepts no new work')
    client.close()
  }, 20_000)
})
