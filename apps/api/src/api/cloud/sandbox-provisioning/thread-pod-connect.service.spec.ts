import { channelTicketValid, podConnectReplySchema } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import {
  podServiceOver,
  realEndpoints,
  SERVE_TOKEN,
  SERVE_URL,
  seedServingPod,
} from './thread-pod.fixture'

const connect = (args: { userId?: string; threadId?: string } = {}) =>
  podServiceOver(realEndpoints()).connect({
    userId: args.userId ?? 'usr-1',
    threadId: args.threadId ?? 'thr-1',
  })

describe('ThreadPodService.connect', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1', 'usr-2')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
  })

  it('mints a 60 second ticket for a running pod and never the serve token', async () => {
    await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })
    const before = Date.now()

    const reply = podConnectReplySchema.parse(await connect())

    expect(reply.url).toBe(SERVE_URL)
    expect(reply.token).not.toBe(SERVE_TOKEN)
    expect(JSON.stringify(reply)).not.toContain(SERVE_TOKEN)
    const expiresMs = Date.parse(reply.expiresAt)
    expect(expiresMs).toBeGreaterThan(before + 58_000)
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + 60_000)
    const ticket = { serveToken: SERVE_TOKEN, threadId: 'thr-1', ticket: reply.token }
    expect(channelTicketValid({ ...ticket, nowMs: Date.now() })).toBe(true)
    expect(channelTicketValid({ ...ticket, nowMs: Date.now() + 61_000 })).toBe(false)
    expect(channelTicketValid({ ...ticket, threadId: 'thr-2', nowMs: Date.now() })).toBe(false)
  })

  it('answers 409 pod-not-running when the thread has no sandbox row', async () => {
    await expect(connect()).rejects.toMatchObject({
      status: 409,
      response: { code: 'pod-not-running' },
    })
  })

  it('answers 409 pod-not-running for a booting pod', async () => {
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      state: 'resuming',
      wakeClaim: new Date(),
      serveUrl: null,
      sealedToken: null,
    })

    await expect(connect()).rejects.toMatchObject({
      status: 409,
      response: { code: 'pod-not-running' },
    })
  })

  it('answers 409 pod-not-running for a parked pod', async () => {
    await seedServingPod({ threadId: 'thr-1', userId: 'usr-1', state: 'parked' })

    await expect(connect()).rejects.toMatchObject({
      status: 409,
      response: { code: 'pod-not-running' },
    })
  })

  it("answers 404 for someone else's thread, even with a running pod", async () => {
    await seedServingPod({ threadId: 'thr-1', userId: 'usr-1' })

    await expect(connect({ userId: 'usr-2' })).rejects.toMatchObject({ status: 404 })
  })
})
