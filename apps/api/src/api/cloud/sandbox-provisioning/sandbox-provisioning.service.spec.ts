import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import { podProvisionIdempotencyKey } from './pod-provision.contract'
import {
  bootSteps,
  cipher,
  fakeDispatcher,
  fakeScoped,
  provisioningWith,
  sandboxRows,
  seedSandboxRow,
  seedThread,
  threadRow,
} from './sandbox-provisioning.fixture'
import { DISPATCH_FAILED_MESSAGE } from './pod-launch.service'

const ARGS = { userId: 'usr-1', threadId: 'thr-1' } as const

const row = async () => {
  const held = (await sandboxRows())[0]
  if (held === undefined) throw new Error('no sandbox row')
  return held
}

describe('SandboxProvisioningService (retry)', () => {
  useTestDatabase()

  it('claims once and dispatches once under a concurrent double POST', async () => {
    await seedThread()
    const { service, dispatch } = provisioningWith()

    const replies = await Promise.all([service.provision(ARGS), service.provision(ARGS)])

    expect(replies.map((reply) => reply.state)).toEqual([
      ESandboxProvisionState.Booting,
      ESandboxProvisionState.Booting,
    ])
    expect(dispatch).toHaveBeenCalledTimes(1)
    const claimed = await row()
    const [job] = dispatch.mock.calls[0] ?? []
    expect(job?.payload).toEqual({
      threadId: 'thr-1',
      wakeClaim: claimed.wakeClaim?.toISOString() ?? '',
    })
    expect(job?.task.id).toBe('pod-provision')
    expect(job?.idempotencyKey).toBe(podProvisionIdempotencyKey(job?.payload ?? never()))
    expect(cipher.decrypt(claimed.sealedToken ?? '')).toHaveLength(43)
  })

  it('answers the standing state without dispatching again', async () => {
    await seedThread()
    const { service, dispatch } = provisioningWith()
    await service.provision(ARGS)

    expect(await service.provision(ARGS)).toEqual({ state: ESandboxProvisionState.Booting })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('answers Running for a running sandbox', async () => {
    await seedThread()
    await seedSandboxRow({ state: 'running', serveUrl: 'https://serve.example.test' })
    const { service, dispatch } = provisioningWith()

    expect(await service.provision(ARGS)).toEqual({ state: ESandboxProvisionState.Running })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('reports a credential gap as a Provision error step and claims nothing', async () => {
    await seedThread()
    const failure = new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    const scoped = fakeScoped({ vercelCredentials: vi.fn(async () => Promise.reject(failure)) })
    const { service, dispatch } = provisioningWith({ scoped })

    expect(await service.provision(ARGS)).toEqual({
      state: ESandboxProvisionState.NotConfigured,
      error: failure.message,
      gap: EVercelCredentialGap.UserCredential,
    })
    expect(await bootSteps()).toMatchObject([
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

  it('provisions a thread with no project, resolving credentials through its owner', async () => {
    await seedThread({ projectId: null })
    const scoped = fakeScoped()
    const { service, dispatch } = provisioningWith({ scoped })

    expect(await service.provision(ARGS)).toEqual({ state: ESandboxProvisionState.Booting })

    expect(scoped.vercelCredentials).toHaveBeenCalledWith({
      thread: { userId: 'usr-1', organizationId: null },
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect((await threadRow())?.executionLocation).toBe('cloud')
  })

  it("does not provision another user's thread", async () => {
    await seedThread()
    const { service, dispatch } = provisioningWith()

    await expect(service.provision({ ...ARGS, userId: 'usr-2' })).rejects.toThrow(
      'thread not found',
    )
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('re-claims a failed row with a fresh token and dispatches again', async () => {
    await seedThread()
    await seedSandboxRow({ wakeClaim: null, wakeFailedAt: new Date() })
    const before = await row()
    const { service, dispatch } = provisioningWith()

    expect(await service.provision(ARGS)).toEqual({ state: ESandboxProvisionState.Booting })

    expect(dispatch).toHaveBeenCalledTimes(1)
    const after = await row()
    expect(after.tokenHash).not.toBe(before.tokenHash)
    expect(after.wakeClaim).not.toBeNull()
  })

  it('records the failure, releases the claim and answers 502 when dispatch throws', async () => {
    await seedThread()
    const dispatcher = fakeDispatcher({ failWith: new Error('trigger is down') })
    const { service } = provisioningWith({ dispatcher })

    await expect(service.provision(ARGS)).rejects.toMatchObject({
      status: 502,
      message: DISPATCH_FAILED_MESSAGE,
    })

    expect(await row()).toMatchObject({ wakeClaim: null })
    expect((await row()).wakeFailedAt).not.toBeNull()
    expect(await bootSteps()).toMatchObject([
      { step: 'provision', state: 'running' },
      { step: 'provision', state: 'error', error: DISPATCH_FAILED_MESSAGE },
    ])
    expect(await db.orm.public.Event.all()).toHaveLength(0)
  })
})

const never = (): never => {
  throw new Error('unreachable')
}
