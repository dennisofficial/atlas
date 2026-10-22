import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, spyOn, vi } from 'bun:test'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import { DISPATCH_FAILED_MESSAGE, PodLaunchService } from './pod-launch.service'
import {
  bootSteps,
  cipher,
  eventsOf,
  fakeDispatcher,
  fakeScoped,
  launchWith,
  sandboxRows,
  seedBase,
} from './sandbox-provisioning.fixture'
import { ThreadLaunchService } from './thread-launch.service'

const FIRST = { sendId: 'snd-1', text: 'build me a thing' }
const create = (service: ThreadLaunchService, draft: Record<string, string> = {}) =>
  service.launch({ userId: 'usr-1', draft: { projectId: 'prj-1', ...draft }, firstMessage: FIRST })

const threads = () => db.orm.public.Thread.all()

describe('ThreadLaunchService', () => {
  useTestDatabase()

  it('writes the thread, the first user-said event and the claim, then dispatches once', async () => {
    await seedBase()
    const { service, dispatch } = launchWith()

    const reply = await create(service, { model: 'claude-x', effort: 'high' })

    expect(reply.provision).toEqual({ state: ESandboxProvisionState.Booting })
    const [thread] = await threads()
    expect(thread).toMatchObject({
      id: reply.thread.id,
      userId: 'usr-1',
      projectId: 'prj-1',
      organizationId: null,
      executionLocation: 'cloud',
      modelRef: 'claude-x',
      modelEffort: 'high',
      head: 1,
    })
    expect(reply.thread.head).toBe(1)

    const [event] = await eventsOf(reply.thread.id)
    expect(event).toMatchObject({ seq: 1, type: 'user-said', userId: 'usr-1' })
    expect(event?.runId).toMatch(/^run_/)
    expect(JSON.parse(event?.body ?? '')).toEqual({
      type: 'user-said',
      text: FIRST.text,
      requestId: FIRST.sendId,
    })

    const [claimed] = await sandboxRows()
    expect(claimed).toMatchObject({ threadId: reply.thread.id, state: 'resuming' })
    expect(cipher.decrypt(claimed?.sealedToken ?? '')).toHaveLength(43)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      payload: { threadId: reply.thread.id, wakeClaim: claimed?.wakeClaim?.toISOString() },
      idempotencyKey: `pod-provision:${reply.thread.id}:${claimed?.wakeClaim?.toISOString()}`,
    })
  })

  it("stores the project's workspace as the owner and resolves credentials through it", async () => {
    await seedBase()
    const scoped = fakeScoped()
    const { service } = launchWith({ scoped })

    const reply = await create(service, { projectId: 'prj-ws' })

    expect((await threads())[0]?.organizationId).toBe('org-1')
    expect(reply.thread.id).toBeDefined()
    expect(scoped.vercelCredentials).toHaveBeenCalledWith({
      thread: { userId: 'usr-1', organizationId: 'org-1' },
    })
  })

  it('creates a personal thread without a project', async () => {
    await seedBase()
    const scoped = fakeScoped()
    const { service, dispatch } = launchWith({ scoped })

    await service.launch({ userId: 'usr-1', draft: {}, firstMessage: FIRST })

    expect(await threads()).toMatchObject([{ projectId: null, organizationId: null }])
    expect(scoped.vercelCredentials).toHaveBeenCalledWith({
      thread: { userId: 'usr-1', organizationId: null },
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('still creates the thread and message on a credential gap, with no claim and no dispatch', async () => {
    await seedBase()
    const failure = new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    const scoped = fakeScoped({ vercelCredentials: vi.fn(async () => Promise.reject(failure)) })
    const { service, dispatch } = launchWith({ scoped })

    const reply = await create(service)

    expect(reply.provision).toEqual({
      state: ESandboxProvisionState.NotConfigured,
      error: failure.message,
      gap: EVercelCredentialGap.UserCredential,
    })
    expect(await threads()).toHaveLength(1)
    expect(await eventsOf(reply.thread.id)).toHaveLength(1)
    expect(await bootSteps(reply.thread.id)).toMatchObject([
      {
        step: 'provision',
        state: 'error',
        error: failure.message,
        gap: EVercelCredentialGap.UserCredential,
      },
    ])
    expect(await sandboxRows()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('writes nothing when the claim fails inside the transaction', async () => {
    await seedBase()
    const { service } = launchWith()
    spyOn(PodLaunchService.prototype, 'claim').mockRejectedValueOnce(new Error('claim exploded'))

    await expect(create(service)).rejects.toThrow('claim exploded')

    expect(await threads()).toHaveLength(0)
    expect(await db.orm.public.Event.all()).toHaveLength(0)
    expect(await sandboxRows()).toHaveLength(0)
  })

  it('keeps the thread when dispatch throws, marks the claim failed and records a step', async () => {
    await seedBase()
    const dispatcher = fakeDispatcher({ failWith: new Error('trigger is down') })
    const { service } = launchWith({ dispatcher })

    const reply = await create(service)

    expect(reply.provision.state).toBe(ESandboxProvisionState.Booting)
    expect(await threads()).toHaveLength(1)
    expect(await eventsOf(reply.thread.id)).toHaveLength(1)
    const [claimed] = await sandboxRows()
    expect(claimed?.wakeClaim).toBeNull()
    expect(claimed?.wakeFailedAt).not.toBeNull()
    expect(await bootSteps(reply.thread.id)).toMatchObject([
      { step: 'provision', state: 'running' },
      { step: 'provision', state: 'error', error: DISPATCH_FAILED_MESSAGE },
    ])
  })

  it('returns the existing thread for a retried sendId without creating or dispatching again', async () => {
    await seedBase()
    const { service, dispatch } = launchWith()

    const first = await create(service)
    const retry = await create(service)

    expect(retry.thread.id).toBe(first.thread.id)
    expect(retry.provision).toEqual({ state: ESandboxProvisionState.Booting })
    expect(await threads()).toHaveLength(1)
    expect(await eventsOf(first.thread.id)).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('creates one thread when two retries of the same sendId race', async () => {
    await seedBase()
    const { service, dispatch } = launchWith()

    const [a, b] = await Promise.all([create(service), create(service)])

    expect(a.thread.id).toBe(b.thread.id)
    expect(await threads()).toHaveLength(1)
    expect(await sandboxRows()).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("does not reuse another user's thread for the same sendId", async () => {
    await seedBase()
    await seedUser({ db, id: 'usr-2' })
    const { service } = launchWith()

    const mine = await create(service)
    const theirs = await service.launch({ userId: 'usr-2', draft: {}, firstMessage: FIRST })

    expect(theirs.thread.id).not.toBe(mine.thread.id)
    expect(await threads()).toHaveLength(2)
  })

  it('refuses a project the user cannot reach and creates nothing', async () => {
    await seedBase()
    const { service, dispatch } = launchWith()

    await expect(
      service.launch({
        userId: 'usr-1',
        draft: { projectId: 'prj-missing' },
        firstMessage: FIRST,
      }),
    ).rejects.toThrow('project not found')
    expect(await threads()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
