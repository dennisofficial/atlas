import { db } from '@dltech/atlas-db'
import { seedSession, seedThread as seedThreadRow, useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { appendRaw, seedProvisionedRow, seedThread } from './sandbox-provisioning.fixture'
import { STUCK_THRESHOLD_MS, stuckSessionTargets } from './stuck-sessions'

const SERVE_URL = 'https://sbx-1.vercel.run'

const agoMs = (ms: number): Date => new Date(Date.now() - ms)

const OLD = STUCK_THRESHOLD_MS + 60_000

const USER_SAID = JSON.stringify({ type: 'user-said', text: 'hello', requestId: 'req-1' })

async function ageThread(args: { threadId: string; by: number }): Promise<void> {
  const at = agoMs(args.by)
  await db.orm.public.Event.where({ threadId: args.threadId }).update({ at })
  await db.orm.public.Thread.where({ id: args.threadId }).update({ updatedAt: at })
}

async function seedStuckPod(
  partial: { wakeClaim?: Date | null; state?: string; activityAgo?: number } = {},
): Promise<void> {
  await seedThread()
  await seedProvisionedRow({
    state: partial.state ?? 'running',
    wakeClaim: partial.wakeClaim === undefined ? null : partial.wakeClaim,
    serveUrl: SERVE_URL,
  })
  await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
    lastActivityAt: agoMs(partial.activityAgo ?? OLD),
  })
  await appendRaw({ type: 'user-said', body: USER_SAID })
  await ageThread({ threadId: 'thr-1', by: OLD })
}

describe('stuckSessionTargets', () => {
  useTestDatabase()

  it('returns a running pod whose old user-said is unanswered and whose activity is stale', async () => {
    await seedStuckPod()

    const targets = await stuckSessionTargets()

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ threadId: 'thr-1', stuckThreadId: 'thr-1' })
    expect(targets[0]?.sandbox.id).toBe('sbx-1')
  })

  it('skips a user-said an assistant-said answered', async () => {
    await seedStuckPod()
    await appendRaw({ type: 'assistant-said', body: '{"type":"assistant-said"}' })
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ lastAssistantSeq: 2 })
    await ageThread({ threadId: 'thr-1', by: OLD })

    expect(await stuckSessionTargets()).toEqual([])
  })

  it('skips a user-said younger than the threshold', async () => {
    await seedStuckPod()
    await ageThread({ threadId: 'thr-1', by: 60_000 })

    expect(await stuckSessionTargets()).toEqual([])
  })

  it('skips a pod whose lastActivityAt is fresh', async () => {
    await seedStuckPod({ activityAgo: 60_000 })

    expect(await stuckSessionTargets()).toEqual([])
  })

  it('skips a pod with an active wake claim', async () => {
    await seedStuckPod({ wakeClaim: new Date() })

    expect(await stuckSessionTargets()).toEqual([])
  })

  it('skips parked and resuming rows', async () => {
    await seedStuckPod({ state: 'parked' })
    expect(await stuckSessionTargets()).toEqual([])

    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      state: 'resuming',
    })
    expect(await stuckSessionTargets()).toEqual([])
  })

  it('skips a failed row that lost its serveUrl', async () => {
    await seedStuckPod()
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      serveUrl: null,
      wakeFailedAt: new Date(),
    })

    expect(await stuckSessionTargets()).toEqual([])
  })

  it('skips a TUI BYO row that has no boot steps', async () => {
    await seedStuckPod()
    await db.orm.public.SandboxBootStep.where({ sessionId: 'ses_thr-1' }).delete()

    expect(await stuckSessionTargets()).toEqual([])
  })

  it('finds an unanswered message on a teammate thread and names the pod root thread', async () => {
    await seedStuckPod()
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ lastAssistantSeq: 1 })
    await seedSession({
      db,
      id: 'ses-mate',
      userId: 'usr-1',
      managedBySessionId: 'ses_thr-1',
    })
    await seedThreadRow({ db, id: 'thr-mate', userId: 'usr-1', sessionId: 'ses-mate' })
    await appendRaw({ type: 'user-said', body: USER_SAID, threadId: 'thr-mate' })
    await ageThread({ threadId: 'thr-mate', by: OLD })

    const targets = await stuckSessionTargets()

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ threadId: 'thr-1', stuckThreadId: 'thr-mate' })
  })

  it('treats a pod as active while any family thread is fresh', async () => {
    await seedStuckPod()
    await seedSession({
      db,
      id: 'ses-mate',
      userId: 'usr-1',
      managedBySessionId: 'ses_thr-1',
    })
    await seedThreadRow({ db, id: 'thr-mate', userId: 'usr-1', sessionId: 'ses-mate' })
    await appendRaw({ type: 'assistant-said', body: '{}', threadId: 'thr-mate' })

    expect(await stuckSessionTargets()).toEqual([])
  })
})
