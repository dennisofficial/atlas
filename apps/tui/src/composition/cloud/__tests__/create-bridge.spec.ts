import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState } from '@dltech/atlas-harness'
import type { VercelSandboxConfig } from '@dltech/atlas-wire'
import { createCloudBridge, type BridgeDriver } from '../create-bridge'

const THREAD = toThreadId('brn_cloud')

type RecordedWrite = { path: string; content: Uint8Array | string }

const CONFIG: VercelSandboxConfig = {
  credentials: { token: 'vercel-test-token', teamId: 'team_test', projectId: 'prj_test' },
  image: 'atlas-sandbox:test',
}

type FakeDriver = BridgeDriver & {
  readonly written: RecordedWrite[]
  readonly tokens: readonly (string | undefined)[]
}

const fakeDriver = (args: { created: boolean }): FakeDriver => {
  const written: RecordedWrite[] = []
  const tokens: (string | undefined)[] = []
  const sandbox = {}
  return {
    written,
    tokens,
    inspect: async () =>
      args.created
        ? undefined
        : { state: ECloudSandboxState.Running, url: 'https://sb.vercel.run' },
    createOrResume: async (createArgs) => {
      tokens.push(createArgs.token)
      await createArgs.putContextOnFreshBoot?.(sandbox as never)
      return {
        sessionId: 'session-1',
        url: 'https://sb.vercel.run',
        state: ECloudSandboxState.Running,
        created: args.created,
        token: createArgs.token ?? 'driver-minted',
      }
    },
    writeBootstrapFileToSandbox: async (write) => {
      written.push({ path: write.path, content: write.content })
    },
    writeBootstrapFile: async () => undefined,
    readResources: async () => ({}),
    updateResources: async () => undefined,
    destroy: async () => undefined,
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const bridgeWith = (args: {
  driver: FakeDriver
  token?: string
  signedIn?: boolean
  registration?: (() => unknown) | undefined
  sendRegistration?: ((registration: Record<string, unknown>) => unknown) | undefined
  onRegistrationFailed?: ((failure: unknown) => void) | undefined
}) =>
  createCloudBridge({
    vercel: () => CONFIG,
    attachmentToken: () => args.token ?? 'stable-serve-token',
    ...(args.registration === undefined
      ? args.signedIn === false
        ? {}
        : { registration: () => ({}) }
      : { registration: args.registration as () => undefined }),
    ...(args.sendRegistration === undefined
      ? {}
      : { sendRegistration: ({ registration }) => args.sendRegistration?.({ ...registration }) }),
    ...(args.onRegistrationFailed === undefined
      ? {}
      : { onRegistrationFailed: args.onRegistrationFailed }),
    driverWith: () => args.driver,
  })

describe('createCloudBridge sandboxes.create', () => {
  it('provisions with no control-plane client at all: no url, no session token, no claim', async () => {
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({ driver, token: 'stable-serve-token', signedIn: false })

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect(sandbox.token).toBe('stable-serve-token')
    expect(driver.tokens).toEqual(['stable-serve-token'])
    expect(sandbox.created).toBe(true)
  })

  it('writes the project pointer before launch on a fresh boot', async () => {
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({ driver, signedIn: false })

    await bridge.sandboxes.create({ threadId: THREAD, projectId: 'proj_1' })

    const paths = driver.written.map((write) => write.path)
    expect(paths).toContain('/atlas/home/bootstrap/workspace-spec.json')

    const spec = driver.written.find((write) => write.path.endsWith('workspace-spec.json'))
    expect(JSON.parse(String(spec?.content))).toEqual({
      remoteUrl: null,
      githubToken: null,
      projectId: 'proj_1',
    })
  })

  it('never rewrites the workspace spec on a resume', async () => {
    const driver = fakeDriver({ created: false })
    const bridge = bridgeWith({ driver, signedIn: false })

    await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect(driver.written).toEqual([])
  })

  it('sends the registration after the sandbox answers when signed in', async () => {
    const registered: Record<string, unknown>[] = []
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      token: 'stable-serve-token',
      sendRegistration: (registration) => registered.push(registration),
    })

    await bridge.sandboxes.create({ threadId: THREAD, projectId: null })
    await tick()
    await tick()

    expect(registered).toEqual([
      {
        threadId: THREAD,
        token: 'stable-serve-token',
        serveUrl: 'https://sb.vercel.run',
      },
    ])
  })

  it('skips the registration entirely when signed out', async () => {
    const registered: Record<string, unknown>[] = []
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      signedIn: false,
      sendRegistration: (registration) => registered.push(registration),
    })

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, projectId: null })
    await tick()

    expect(sandbox.state).toBe(ECloudSandboxState.Running)
    expect(registered).toEqual([])
  })

  it('never fails the create when the metadata read throws synchronously', async () => {
    const failed: unknown[] = []
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      registration: () => {
        throw new Error('metadata read blew up')
      },
      sendRegistration: () => undefined,
      onRegistrationFailed: (failure) => failed.push(failure),
    })

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, projectId: null })
    await tick()

    expect(sandbox.state).toBe(ECloudSandboxState.Running)
    expect(failed).toHaveLength(1)
  })

  it('never fails the create when the sender rejects asynchronously', async () => {
    const failed: unknown[] = []
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      sendRegistration: async () => {
        throw new Error('cloud API down')
      },
      onRegistrationFailed: (failure) => failed.push(failure),
    })

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, projectId: null })
    await tick()
    await tick()

    expect(sandbox.state).toBe(ECloudSandboxState.Running)
    expect(failed).toHaveLength(1)
  })

  it('never waits on a hung metadata read', async () => {
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      registration: () => new Promise(() => undefined),
      sendRegistration: () => undefined,
    })

    const started = Date.now()
    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect(sandbox.state).toBe(ECloudSandboxState.Running)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
