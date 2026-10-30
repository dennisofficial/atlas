import { API_PROVISIONED_ENV, SANDBOX_HOME_PATH } from '@dltech/atlas-wire'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, vi } from 'bun:test'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import { EPodProvisionOutcome } from './pod-provision.contract'
import { PROVISION_TIMEOUT_MESSAGE, failPodProvision, runPodProvision } from './pod-provision-run'
import {
  CREDENTIALS,
  bootSteps,
  fakeBoot,
  fakeSandbox,
  fakeScoped,
  runDepsWith,
  sandboxRows,
  seedSandboxRow,
  seedThread,
} from './sandbox-provisioning.fixture'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'

const payloadOf = async () => {
  const [row] = await sandboxRows()
  return { threadId: 'thr-1', wakeClaim: row?.wakeClaim?.toISOString() ?? '' }
}

describe('runPodProvision', () => {
  useTestDatabase()

  it('exits quietly without booting when the claim was superseded', async () => {
    await seedThread()
    await seedSandboxRow()
    const payload = await payloadOf()
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      wakeClaim: new Date(Date.parse(payload.wakeClaim) + 5_000),
    })
    const { boot, calls } = fakeBoot()

    const output = await runPodProvision({ payload, deps: runDepsWith({ boot }) })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect(calls).toHaveLength(0)
    expect((await sandboxRows())[0]?.state).toBe('resuming')
  })

  it('exits quietly when there is no row', async () => {
    await seedThread()
    const { boot, calls } = fakeBoot()

    const output = await runPodProvision({
      payload: { threadId: 'thr-1', wakeClaim: new Date().toISOString() },
      deps: runDepsWith({ boot }),
    })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect(calls).toHaveLength(0)
  })

  it('boots with the unsealed token, owner credentials and no injected Vercel env, then marks running', async () => {
    await seedThread({ modelRef: 'claude-x' })
    await seedSandboxRow()
    const scoped = fakeScoped()
    const { boot, calls } = fakeBoot()

    const output = await runPodProvision({
      payload: await payloadOf(),
      deps: runDepsWith({ boot, scoped }),
    })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Running })
    expect((await sandboxRows())[0]).toMatchObject({
      state: 'running',
      serveUrl: 'https://serve.example.test',
      wakeFailedAt: null,
    })
    const [args] = calls
    expect(args).toMatchObject({
      credentials: CREDENTIALS,
      threadId: 'thr-1',
      name: 'atlas-thread-1',
      image: 'atlas-sandbox:latest',
      cloudUrl: 'https://api.byatlas.io',
      serveVersion: undefined,
      freshToken: 'seed-token',
      resumeToken: 'seed-token',
      injectVercelCredentials: false,
      environment: { [API_PROVISIONED_ENV]: '1' },
    })
    expect(scoped.vercelCredentials).toHaveBeenCalledWith({
      thread: expect.objectContaining({ userId: 'usr-1' }),
    })

    const { sandbox, writeFiles } = fakeSandbox()
    await args?.prepare?.(sandbox)
    const [files] = writeFiles.mock.calls[0] as unknown as [{ path: string; content: string }[]]
    expect(files[0]?.path).toBe(`${SANDBOX_HOME_PATH}/bootstrap/workspace-spec.json`)
    expect(JSON.parse(files[0]?.content ?? '')).toEqual({
      remoteUrl: null,
      githubToken: null,
      projectId: 'prj-1',
      model: 'claude-x',
    })
  })

  it('writes a bootstrap with a null project for a no-project thread', async () => {
    await seedThread({ projectId: null })
    await seedSandboxRow()
    const { boot, calls } = fakeBoot()

    await runPodProvision({ payload: await payloadOf(), deps: runDepsWith({ boot }) })

    const { sandbox, writeFiles } = fakeSandbox()
    await calls[0]?.prepare?.(sandbox)
    const [files] = writeFiles.mock.calls[0] as unknown as [{ content: string }[]]
    const spec = JSON.parse(files[0]?.content ?? '')
    expect(spec).toMatchObject({ projectId: null })
    expect(Object.keys(spec).sort()).toEqual(['githubToken', 'projectId', 'remoteUrl'])
  })

  it('writes boot-step rows through the reporter', async () => {
    await seedThread()
    await seedSandboxRow()
    const boot = {
      boot: async (args: Parameters<ReturnType<typeof fakeBoot>['boot']['boot']>[0]) => {
        await args.reporter?.report({ step: 'provision', state: 'running' } as never)
        return { serveUrl: 'https://serve.example.test', created: false }
      },
    }

    await runPodProvision({ payload: await payloadOf(), deps: runDepsWith({ boot }) })

    expect(await bootSteps()).toMatchObject([{ step: 'provision', state: 'running' }])
  })

  it('marks the row failed and keeps the error step the boot reported', async () => {
    await seedThread()
    await seedSandboxRow()
    const { boot } = fakeBoot({ failWith: new Error('vercel is down') })

    const output = await runPodProvision({
      payload: await payloadOf(),
      deps: runDepsWith({ boot }),
    })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Failed })
    const [row] = await sandboxRows()
    expect(row?.wakeClaim).toBeNull()
    expect(row?.wakeFailedAt).not.toBeNull()
    expect(row?.state).not.toBe('running')
    expect(await bootSteps()).toMatchObject([
      { step: 'provision', state: 'error', error: 'vercel is down' },
    ])
  })

  it('records an error step itself when the failure came before the boot reported one', async () => {
    await seedThread()
    await seedSandboxRow()
    const failure = new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    const scoped = fakeScoped({ vercelCredentials: vi.fn(async () => Promise.reject(failure)) })
    const { boot, calls } = fakeBoot()

    const output = await runPodProvision({
      payload: await payloadOf(),
      deps: runDepsWith({ boot, scoped }),
    })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Failed })
    expect(calls).toHaveLength(0)
    expect(await bootSteps()).toMatchObject([
      { step: 'provision', state: 'error', error: failure.message },
    ])
  })

  it('does not mark running when the claim moved during the boot', async () => {
    await seedThread()
    await seedSandboxRow()
    const payload = await payloadOf()
    const boot = {
      boot: async () => {
        await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
          wakeClaim: new Date(Date.parse(payload.wakeClaim) + 5_000),
        })
        return { serveUrl: 'https://serve.example.test', created: true }
      },
    }

    const output = await runPodProvision({ payload, deps: runDepsWith({ boot }) })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect((await sandboxRows())[0]?.state).toBe('resuming')
  })

  it('writes no error step and reports superseded when the claim moved before the boot failed', async () => {
    await seedThread()
    await seedSandboxRow()
    const payload = await payloadOf()
    const boot = {
      boot: async () => {
        await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
          wakeClaim: new Date(Date.parse(payload.wakeClaim) + 5_000),
        })
        throw new Error('vercel is down')
      },
    }

    const output = await runPodProvision({ payload, deps: runDepsWith({ boot }) })

    expect(output).toEqual({ outcome: EPodProvisionOutcome.Superseded })
    expect(await bootSteps()).toEqual([])
    const [row] = await sandboxRows()
    expect(row?.wakeFailedAt).toBeNull()
    expect(row?.wakeClaim).not.toBeNull()
  })

  it('drops steps the boot reports after the claim moved', async () => {
    await seedThread()
    await seedSandboxRow()
    const payload = await payloadOf()
    const boot = {
      boot: async (args: Parameters<ReturnType<typeof fakeBoot>['boot']['boot']>[0]) => {
        await args.reporter?.report({ step: 'provision', state: 'running' } as never)
        await args.reporter?.flush()
        await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
          wakeClaim: new Date(Date.parse(payload.wakeClaim) + 5_000),
        })
        await args.reporter?.report({ step: 'clone', state: 'running' } as never)
        return { serveUrl: 'https://serve.example.test', created: true }
      },
    }

    await runPodProvision({ payload, deps: runDepsWith({ boot }) })

    expect(await bootSteps()).toMatchObject([{ step: 'provision', state: 'running' }])
  })
})

describe('failPodProvision', () => {
  useTestDatabase()

  it('releases the claim and records a Provision error step', async () => {
    await seedThread()
    await seedSandboxRow()

    await failPodProvision({ payload: await payloadOf(), signals: inertSignals() })

    const [row] = await sandboxRows()
    expect(row?.wakeClaim).toBeNull()
    expect(row?.wakeFailedAt).not.toBeNull()
    expect(await bootSteps()).toMatchObject([
      { step: 'provision', state: 'error', error: PROVISION_TIMEOUT_MESSAGE },
    ])
  })

  it('does nothing when the claim was superseded', async () => {
    await seedThread()
    await seedSandboxRow()
    const payload = await payloadOf()
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      wakeClaim: new Date(Date.parse(payload.wakeClaim) + 5_000),
    })

    await failPodProvision({ payload, signals: inertSignals() })

    const [row] = await sandboxRows()
    expect(row?.wakeFailedAt).toBeNull()
    expect(row?.wakeClaim).not.toBeNull()
    expect(await bootSteps()).toEqual([])
  })
})
