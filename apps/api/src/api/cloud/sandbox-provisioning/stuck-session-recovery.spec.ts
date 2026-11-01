import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import { EBootStep, EBootStepState, EVercelCredentialGap } from '@dltech/atlas-wire'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import {
  appendRaw,
  cipher,
  fakeDispatcher,
  fakeScoped,
  podLaunchWith,
  sandboxRows,
  seedBase,
  seedProvisionedRow,
  seedThread,
} from './sandbox-provisioning.fixture'
import {
  PROBE_TIMEOUT_MS,
  RECOVERY_CAP_PER_RUN,
  recoverStuckSessions,
  serveIsDead,
} from './stuck-session-recovery'
import { STUCK_THRESHOLD_MS } from './stuck-sessions'

const SERVE_URL = 'https://sbx-1.vercel.run'

const OLD = new Date(Date.now() - STUCK_THRESHOLD_MS - 60_000)

const USER_SAID = JSON.stringify({ type: 'user-said', text: 'hello', requestId: 'req-1' })

async function seedStuckPod(): Promise<void> {
  await seedThread()
  await seedProvisionedRow({ state: 'running', wakeClaim: null, serveUrl: SERVE_URL })
  await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
    lastActivityAt: OLD,
  })
  await appendRaw({ type: 'user-said', body: USER_SAID })
  await db.orm.public.Event.where({ threadId: 'thr-1' }).update({ at: OLD })
  await db.orm.public.Thread.where({ id: 'thr-1' }).update({ updatedAt: OLD })
}

const respondWith = (status: number) =>
  vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      new Response('', { status }),
  )

function depsWith(args: {
  fetch: typeof fetch
  dispatcher?: ReturnType<typeof fakeDispatcher>
  scoped?: ReturnType<typeof fakeScoped>
}) {
  const { pod, dispatch } = podLaunchWith({
    ...(args.dispatcher === undefined ? {} : { dispatcher: args.dispatcher }),
    ...(args.scoped === undefined ? {} : { scoped: args.scoped }),
  })
  const log = vi.fn((_line: string) => undefined)
  return { deps: { pod, cipher, fetch: args.fetch, log }, dispatch, log }
}

describe('recoverStuckSessions', () => {
  useTestDatabase()

  it('claims and dispatches pod-provision when the serve probe fails', async () => {
    await seedStuckPod()
    const failing = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const { deps, dispatch, log } = depsWith({ fetch: failing as unknown as typeof fetch })

    const summary = await recoverStuckSessions({ deps })

    expect(summary).toEqual({ candidates: 1, recovered: 1, alive: 0 })
    expect(dispatch).toHaveBeenCalledTimes(1)
    const payload = dispatch.mock.calls[0]?.[0].payload
    expect(payload?.threadId).toBe('thr-1')
    const row = (await sandboxRows())[0]
    expect(row?.state).toBe('resuming')
    expect(row?.wakeClaim?.toISOString()).toBe(payload?.wakeClaim)
    expect(log.mock.calls[0]?.[0]).toContain('sbx-1')
    expect(log.mock.calls[0]?.[0]).toContain('thr-1')
  })

  it('re-provisions on a 5xx probe answer', async () => {
    await seedStuckPod()
    const { deps, dispatch } = depsWith({ fetch: respondWith(503) as unknown as typeof fetch })

    await recoverStuckSessions({ deps })

    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('leaves a pod whose serve answers its health probe', async () => {
    await seedStuckPod()
    const answering = respondWith(200)
    const { deps, dispatch } = depsWith({ fetch: answering as unknown as typeof fetch })

    const summary = await recoverStuckSessions({ deps })

    expect(summary).toEqual({ candidates: 1, recovered: 0, alive: 1 })
    expect(dispatch).not.toHaveBeenCalled()
    const [url, init] = answering.mock.calls[0] ?? []
    expect(String(url)).toBe(`${SERVE_URL}/v1/health`)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer seed-token')
  })

  it('does not dispatch when the claim is lost to another waker', async () => {
    await seedStuckPod()
    const { deps, dispatch } = depsWith({ fetch: respondWith(503) as unknown as typeof fetch })
    const lost = {
      credentialsOf: deps.pod.credentialsOf.bind(deps.pod),
      dispatchClaimed: deps.pod.dispatchClaimed.bind(deps.pod),
      claim: vi.fn(async () => null),
    }

    const summary = await recoverStuckSessions({ deps: { ...deps, pod: lost } })

    expect(summary.recovered).toBe(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('skips an owner whose Vercel credentials are missing', async () => {
    await seedStuckPod()
    const scoped = fakeScoped({
      vercelCredentials: vi.fn(async () => {
        throw new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
      }),
    })
    const { deps, dispatch } = depsWith({
      fetch: respondWith(503) as unknown as typeof fetch,
      scoped,
    })

    const summary = await recoverStuckSessions({ deps })

    expect(summary.recovered).toBe(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('counts a failed dispatch as not recovered', async () => {
    await seedStuckPod()
    const dispatcher = fakeDispatcher({ failWith: new Error('trigger down') })
    const { deps } = depsWith({ fetch: respondWith(503) as unknown as typeof fetch, dispatcher })

    const summary = await recoverStuckSessions({ deps })

    expect(summary.recovered).toBe(0)
  })

  it('caps recoveries per run at ten, oldest first', async () => {
    await seedBase()
    await seedBulkPods({ count: RECOVERY_CAP_PER_RUN + 2 })
    const { deps, dispatch } = depsWith({ fetch: respondWith(503) as unknown as typeof fetch })

    const summary = await recoverStuckSessions({ deps })

    expect(summary.recovered).toBe(RECOVERY_CAP_PER_RUN)
    expect(dispatch).toHaveBeenCalledTimes(RECOVERY_CAP_PER_RUN)
    const dispatched = dispatch.mock.calls.map((call) => call[0].payload.threadId)
    expect(dispatched).not.toContain(`bulk-${RECOVERY_CAP_PER_RUN}`)
    expect(dispatched).not.toContain(`bulk-${RECOVERY_CAP_PER_RUN + 1}`)
    expect(dispatched).toContain('bulk-0')
  })
})

describe('serveIsDead', () => {
  it('bounds the probe with a timeout signal and treats a thrown fetch as dead', async () => {
    const signals: Array<AbortSignal | null | undefined> = []
    const hung = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      signals.push(init?.signal)
      throw new DOMException('timed out', 'TimeoutError')
    })

    const dead = await serveIsDead({
      serveUrl: SERVE_URL,
      token: 't',
      fetch: hung as unknown as typeof fetch,
    })

    expect(dead).toBe(true)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(PROBE_TIMEOUT_MS).toBe(5_000)
  })

  it('treats a 401 as alive: the serve answered', async () => {
    const dead = await serveIsDead({
      serveUrl: SERVE_URL,
      token: 't',
      fetch: respondWith(401) as unknown as typeof fetch,
    })

    expect(dead).toBe(false)
  })
})

async function seedBulkPods(args: { count: number }): Promise<void> {
  for (let index = 0; index < args.count; index += 1) {
    const threadId = `bulk-${index}`
    const at = new Date(OLD.getTime() - (args.count - index) * 1_000)
    await db.orm.public.Session.create({
      id: `ses_${threadId}`,
      userId: 'usr-1',
      createdAt: at,
      updatedAt: at,
    })
    await db.orm.public.Thread.create({
      id: threadId,
      userId: 'usr-1',
      sessionId: `ses_${threadId}`,
      createdAt: at,
      updatedAt: at,
    })
    await db.orm.public.Session.where({ id: `ses_${threadId}` }).update({ mainThreadId: threadId })
    await db.orm.public.CloudSandbox.create({
      id: `sbx-${threadId}`,
      sessionId: `ses_${threadId}`,
      userId: 'usr-1',
      sandboxId: '',
      name: `atlas-${threadId}`,
      region: 'iad1',
      state: 'running',
      lastActivityAt: at,
      tokenHash: `hash-${threadId}`,
      sealedToken: cipher.encrypt('seed-token'),
      serveUrl: `https://${threadId}.vercel.run`,
      createdAt: at,
      updatedAt: at,
    })
    await recordBootSteps({
      threadId,
      steps: [{ step: EBootStep.Provision, state: EBootStepState.Done }],
    })
    await appendRaw({ type: 'user-said', body: USER_SAID, threadId })
    await db.orm.public.Event.where({ threadId }).update({ at })
    await db.orm.public.Thread.where({ id: threadId }).update({ updatedAt: at })
  }
}
