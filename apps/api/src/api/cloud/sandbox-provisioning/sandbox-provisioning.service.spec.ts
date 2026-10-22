import { API_PROVISIONED_ENV, BOOT_RUN_ID, ESandboxProvisionState, SANDBOX_HOME_PATH } from '@dltech/atlas-wire'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { PrismaClient } from '../../../generated/prisma/client'

mock.module('../../../db', () => ({ db: provisioningFakeDb().db as unknown as PrismaClient }))

import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import {
  CREDENTIALS,
  fake,
  fakeBoot,
  fakeSandbox,
  fakeScoped,
  seedThread,
  serviceWith,
} from './sandbox-provisioning.fixture'
import { NO_PROJECT_MESSAGE } from './sandbox-provisioning.service'
import { provisioningFakeDb } from '../../../../test/sandbox-provisioning-fake-db.js'

const ARGS = { userId: 'usr-1', threadId: 'thr-1' } as const

const bootStepEvents = () =>
  fake.events
    .filter((event) => event.type === 'sandbox-boot-step')
    .map((event) => ({ runId: event.runId, ...JSON.parse(event.body) as Record<string, string> }))

const row = () => {
  const held = fake.sandboxes[0]
  if (held === undefined) throw new Error('no sandbox row')
  return held
}

describe('SandboxProvisioningService', () => {
  beforeEach(() => {
    fake.reset()
  })

  it('boots exactly once under a concurrent double send', async () => {
    seedThread()
    let release: () => void = () => undefined
    const { boot, calls } = fakeBoot({ held: new Promise<void>((resolve) => (release = resolve)) })
    const service = serviceWith({ boot })

    const replies = await Promise.all([service.provision(ARGS), service.provision(ARGS)])

    expect(replies.map((reply) => reply.state)).toEqual([
      ESandboxProvisionState.Booting,
      ESandboxProvisionState.Booting,
    ])
    release()
    await service.settle()
    expect(calls).toHaveLength(1)
    expect(row()).toMatchObject({ state: 'running', serveUrl: 'https://serve.example.test', wakeFailedAt: null })
    expect(await service.provision(ARGS)).toEqual({ state: ESandboxProvisionState.Running })
    expect(calls).toHaveLength(1)
  })

  it('answers Booting while a recent claim is in flight', async () => {
    seedThread()
    const { boot, calls } = fakeBoot({ held: new Promise<void>(() => undefined) })
    const service = serviceWith({ boot })

    await service.provision(ARGS)
    expect(await service.provision(ARGS)).toEqual({ state: ESandboxProvisionState.Booting })
    expect(calls).toHaveLength(1)
  })

  it('reports a missing Vercel credential as a Provision error and boots nothing', async () => {
    seedThread()
    const failure = new VercelNotConfiguredError(EVercelCredentialGap.WorkspaceCredential)
    const scoped = fakeScoped({ vercelCredentials: vi.fn(async () => Promise.reject(failure)) })
    const { boot, calls } = fakeBoot()

    const reply = await serviceWith({ boot, scoped }).provision(ARGS)

    expect(reply).toEqual({ state: ESandboxProvisionState.NotConfigured, error: failure.message })
    expect(failure.message).toContain('Workspace → Secrets')
    expect<unknown>(bootStepEvents()).toEqual([
      { runId: BOOT_RUN_ID, step: 'provision', state: 'error', error: failure.message },
    ])
    expect(fake.sandboxes).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('asks for a project when the thread has none and the body gives none', async () => {
    seedThread({ projectId: null })
    const scoped = fakeScoped()
    const { boot, calls } = fakeBoot()

    const reply = await serviceWith({ boot, scoped }).provision(ARGS)

    expect(reply).toEqual({ state: ESandboxProvisionState.NotConfigured, error: NO_PROJECT_MESSAGE })
    expect(bootStepEvents()).toMatchObject([{ step: 'provision', state: 'error', error: NO_PROJECT_MESSAGE }])
    expect(scoped.vercelCredentials).not.toHaveBeenCalled()
    expect(fake.sandboxes).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('persists a body projectId onto a thread that has none', async () => {
    seedThread({ projectId: null })
    const scoped = fakeScoped()
    const { boot, calls } = fakeBoot()
    const service = serviceWith({ boot, scoped })

    await service.provision({ ...ARGS, projectId: 'prj-9' })
    await service.settle()

    expect(scoped.accessibleProject).toHaveBeenCalledWith({ userId: 'usr-1', projectId: 'prj-9' })
    expect(fake.threads[0]).toMatchObject({ projectId: 'prj-9', executionLocation: 'cloud' })
    expect(scoped.vercelCredentials).toHaveBeenCalledWith({ projectId: 'prj-9' })
    expect(calls).toHaveLength(1)
  })

  it('marks a thread that already has a project as cloud when it boots', async () => {
    seedThread({ projectId: 'prj-1' })
    const service = serviceWith({ boot: fakeBoot().boot })

    await service.provision(ARGS)
    await service.settle()

    expect(fake.threads[0]?.executionLocation).toBe('cloud')
  })

  it('ignores a body projectId once the thread has a project', async () => {
    seedThread({ projectId: 'prj-1' })
    const scoped = fakeScoped()
    const service = serviceWith({ boot: fakeBoot().boot, scoped })

    await service.provision({ ...ARGS, projectId: 'prj-9' })
    await service.settle()

    expect(scoped.accessibleProject).not.toHaveBeenCalled()
    expect(fake.threads[0]?.projectId).toBe('prj-1')
  })

  it('does not provision another user\'s thread', async () => {
    seedThread()
    const { boot, calls } = fakeBoot()

    await expect(serviceWith({ boot }).provision({ ...ARGS, userId: 'usr-2' })).rejects.toThrow('thread not found')
    expect(calls).toHaveLength(0)
  })

  it('records a failed boot, then a second POST re-claims and boots again', async () => {
    seedThread()
    const failing = fakeBoot({ failWith: new Error('vercel is down') })
    const first = serviceWith({ boot: failing.boot })

    await first.provision(ARGS)
    await first.settle()

    expect(row().wakeClaim).toBeNull()
    expect(row().wakeFailedAt).not.toBeNull()
    expect(row().state).not.toBe('running')
    expect(bootStepEvents()).toMatchObject([{ step: 'provision', state: 'error', error: 'vercel is down' }])
    const firstTokenHash = row().tokenHash

    const working = fakeBoot()
    const second = serviceWith({ boot: working.boot })
    expect(await second.provision(ARGS)).toEqual({ state: ESandboxProvisionState.Booting })
    await second.settle()

    expect(working.calls).toHaveLength(1)
    expect(row().tokenHash).not.toBe(firstTokenHash)
    expect(row()).toMatchObject({ state: 'running', wakeFailedAt: null })
    expect(working.calls[0]?.freshToken).toBe(working.calls[0]?.resumeToken)
  })

  it('boots once when two retries race to re-claim a failed row', async () => {
    seedThread()
    const failing = fakeBoot({ failWith: new Error('vercel is down') })
    const first = serviceWith({ boot: failing.boot })
    await first.provision(ARGS)
    await first.settle()

    const working = fakeBoot({ held: new Promise<void>(() => undefined) })
    const service = serviceWith({ boot: working.boot })
    await Promise.all([service.provision(ARGS), service.provision(ARGS)])

    expect(working.calls).toHaveLength(1)
  })

  it('boots with workspace credentials, no injected Vercel credentials, and the api-provisioned flag', async () => {
    seedThread({ modelRef: 'claude-x' })
    const { boot, calls } = fakeBoot()
    const service = serviceWith({ boot })

    await service.provision(ARGS)
    await service.settle()

    const [args] = calls
    expect(args).toMatchObject({
      credentials: CREDENTIALS,
      threadId: 'thr-1',
      image: 'atlas-sandbox:latest',
      cloudUrl: 'https://api.byatlas.io',
      serveVersion: undefined,
      injectVercelCredentials: false,
      environment: { [API_PROVISIONED_ENV]: '1' },
    })
    expect(args?.name).toMatch(/^atlas-thread-/)
    expect(args?.reporter).toBeDefined()

    const { sandbox, runCommand, writeFiles } = fakeSandbox()
    await args?.prepare?.(sandbox)
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['-c', `mkdir -p ${SANDBOX_HOME_PATH}/bootstrap`] }),
    )
    const [files] = writeFiles.mock.calls[0] as unknown as [{ path: string; content: string; mode: number }[]]
    expect(files[0]).toMatchObject({ path: `${SANDBOX_HOME_PATH}/bootstrap/workspace-spec.json`, mode: 0o600 })
    expect(JSON.parse(files[0]?.content ?? '')).toEqual({
      remoteUrl: null,
      githubToken: null,
      projectId: 'prj-1',
      model: 'claude-x',
    })
  })
})
