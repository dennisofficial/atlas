import { describe, expect, it } from 'bun:test'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { PortableState } from '@dltech/atlas-wire'

import {
  ECloudSandboxState,
  type CloudSandboxes,
  type VercelSandboxConfig,
} from '@dltech/atlas-harness'
import {
  createCloudBridge,
  parkedEscalationOf,
  type BridgeDriver,
  type PortableOmissions,
} from '../create-bridge'

const THREAD = toThreadId('brn_cloud')

const sandboxesFinding = (
  find: CloudSandboxes['find'],
): Pick<CloudSandboxes, 'find'> => ({ find })

describe('parkedEscalationOf', () => {
  it('escalates when the driver reports the sandbox parked', async () => {
    const sandboxes = sandboxesFinding(async () => ({ state: ECloudSandboxState.Parked }))

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(true)
  })

  it('stays put for a sandbox that is running', async () => {
    const sandboxes = sandboxesFinding(async () => ({
      state: ECloudSandboxState.Running,
      url: 'https://box.vercel.run',
    }))

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })

  it('stays put for a sandbox that is only resuming', async () => {
    const sandboxes = sandboxesFinding(async () => ({ state: ECloudSandboxState.Resuming }))

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })

  it('swallows a driver failure rather than escalating on a guess', async () => {
    const sandboxes = sandboxesFinding(async () => {
      throw new Error('vercel said no')
    })

    expect(await parkedEscalationOf({ sandboxes, threadId: THREAD })()).toBe(false)
  })
})

type RecordedWrite = { path: string; content: Uint8Array | string }

const CONFIG: VercelSandboxConfig = {
  credentials: { token: 'vercel-test-token', teamId: 'team_test', projectId: 'prj_test' },
  image: 'atlas-sandbox:test',
}

const PORTABLE: PortableState = {
  version: 1,
  vaultKeyHex: 'ab'.repeat(32),
  accounts: [],
  active: [],
  secrets: [],
}

type FakeDriver = BridgeDriver & {
  readonly written: RecordedWrite[]
  readonly tokens: readonly (string | undefined)[]
}

const fakeDriver = (args: { created: boolean; vaultPresent?: boolean }): FakeDriver => {
  const written: RecordedWrite[] = []
  const tokens: (string | undefined)[] = []
  const sandbox = {
    runCommand: async (params: { cmd: string; args?: string[] }) => {
      const script = params.args?.[1] ?? params.cmd
      if (script.includes('auth.json')) {
        return { exitCode: args.vaultPresent === false ? 1 : 0 }
      }
      return { exitCode: 0 }
    },
  }
  return {
    written,
    tokens,
    inspect: async () =>
      args.created ? undefined : { state: ECloudSandboxState.Running, url: 'https://sb.vercel.run' },
    createOrResume: async (createArgs) => {
      tokens.push(createArgs.token)
      await createArgs.putContextOnFreshBoot?.(sandbox as never)
      return {
        sessionId: 'session-1',
        url: 'https://sb.vercel.run',
        state: ECloudSandboxState.Running,
        created: args.created,
        driveName: 'drive-x',
        token: createArgs.token ?? 'driver-minted',
      }
    },
    writeBootstrapFileToSandbox: async (write) => {
      written.push({ path: write.path, content: write.content })
    },
    writeBootstrapFile: async () => undefined,
    transcriptLanded: async () => true,
    destroy: async () => undefined,
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const bridgeWith = (args: {
  driver: FakeDriver
  token?: string
  readGitToken?: (() => Promise<string>) | undefined
  signedIn?: boolean
  portable?: PortableState
  registration?: (() => unknown) | undefined
  sendRegistration?: ((registration: Record<string, unknown>) => unknown) | undefined
  onRegistrationFailed?: ((failure: unknown) => void) | undefined
  onOmitted?: ((omitted: PortableOmissions) => void) | undefined
}) =>
  createCloudBridge({
    vercel: () => CONFIG,
    attachmentToken: () => args.token ?? 'stable-serve-token',
    ...(args.readGitToken === undefined ? {} : { readGitToken: args.readGitToken }),
    capturePortable: async () => args.portable ?? PORTABLE,
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
    ...(args.onOmitted === undefined ? {} : { onPortableOmitted: args.onOmitted }),
    driverWith: () => args.driver,
  })

describe('createCloudBridge sandboxes.create', () => {
  it('provisions with no control-plane client at all: no url, no session token, no claim', async () => {
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({ driver, token: 'stable-serve-token', signedIn: false })

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, workspace: null })

    expect(sandbox.token).toBe('stable-serve-token')
    expect(driver.tokens).toEqual(['stable-serve-token'])
    expect(sandbox.created).toBe(true)
    expect(sandbox.driveName).toBe('drive-x')
  })

  it('writes the workspace spec and portable snapshot before launch on a fresh boot', async () => {
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      readGitToken: async () => 'gho_test_token',
      signedIn: false,
    })

    await bridge.sandboxes.create({ threadId: THREAD, workspace: null })

    const paths = driver.written.map((write) => write.path)
    expect(paths).toContain('/atlas/home/bootstrap/workspace-spec.json')
    expect(paths).toContain('/atlas/home/bootstrap/local-state.json')

    const spec = driver.written.find((write) => write.path.endsWith('workspace-spec.json'))
    expect(JSON.parse(String(spec?.content))).toMatchObject({ githubToken: 'gho_test_token' })
  })

  it('never rewrites the workspace spec or portable snapshot on a resume with a live vault', async () => {
    const driver = fakeDriver({ created: false, vaultPresent: true })
    const bridge = bridgeWith({ driver, signedIn: false })

    await bridge.sandboxes.create({ threadId: THREAD, workspace: null })

    expect(driver.written).toEqual([])
  })

  it('stages the portable snapshot on a resume whose vault never materialised', async () => {
    const driver = fakeDriver({ created: false, vaultPresent: false })
    const bridge = bridgeWith({ driver, signedIn: false })

    await bridge.sandboxes.create({ threadId: THREAD, workspace: null })

    const paths = driver.written.map((write) => write.path)
    expect(paths).toContain('/atlas/home/bootstrap/local-state.json')
    expect(paths).not.toContain('/atlas/home/bootstrap/workspace-spec.json')
  })

  it('boots without push access when the git token read fails', async () => {
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      readGitToken: async () => {
        throw new Error('gh not logged in')
      },
      signedIn: false,
    })

    await bridge.sandboxes.create({ threadId: THREAD, workspace: null })

    const spec = driver.written.find((write) => write.path.endsWith('workspace-spec.json'))
    expect(JSON.parse(String(spec?.content))).toMatchObject({ githubToken: null })
  })

  it('sends the registration after the sandbox answers when signed in', async () => {
    const registered: Record<string, unknown>[] = []
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      token: 'stable-serve-token',
      sendRegistration: (registration) => registered.push(registration),
    })

    await bridge.sandboxes.create({ threadId: THREAD, workspace: null })
    await tick()
    await tick()

    expect(registered).toEqual([
      {
        threadId: THREAD,
        token: 'stable-serve-token',
        serveUrl: 'https://sb.vercel.run',
        driveName: 'drive-x',
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

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, workspace: null })
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

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, workspace: null })
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

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, workspace: null })
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
    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, workspace: null })

    expect(sandbox.state).toBe(ECloudSandboxState.Running)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('reports what the portable snapshot omitted after a fresh boot', async () => {
    const omitted: PortableOmissions[] = []
    const driver = fakeDriver({ created: true })
    const bridge = bridgeWith({
      driver,
      signedIn: false,
      portable: {
        ...PORTABLE,
        omitted: {
          oauthAccounts: ['claude-subscription'],
          mcpOauthSecrets: ['mcp-oauth:linear'],
        },
      },
      onOmitted: (report) => omitted.push(report),
    })

    await bridge.sandboxes.create({ threadId: THREAD, workspace: null })

    expect(omitted).toEqual([
      { oauthAccounts: ['claude-subscription'], mcpOauthSecrets: ['mcp-oauth:linear'] },
    ])
  })

  it('stays quiet when a healthy resume never captured, and when nothing was omitted', async () => {
    const omitted: PortableOmissions[] = []
    const resumed = fakeDriver({ created: false, vaultPresent: true })
    const resumedBridge = bridgeWith({
      driver: resumed,
      signedIn: false,
      portable: {
        ...PORTABLE,
        omitted: { oauthAccounts: ['claude-subscription'], mcpOauthSecrets: [] },
      },
      onOmitted: (report) => omitted.push(report),
    })

    await resumedBridge.sandboxes.create({ threadId: THREAD, workspace: null })

    const fresh = fakeDriver({ created: true })
    const freshBridge = bridgeWith({ driver: fresh, signedIn: false, onOmitted: (report) => omitted.push(report) })

    await freshBridge.sandboxes.create({ threadId: THREAD, workspace: null })

    expect(omitted).toEqual([])
  })

  it('recovers a failed first boot: a retry that now resumes still stages the snapshot', async () => {
    const driver = fakeDriver({ created: false, vaultPresent: false })
    const captures: number[] = []
    const bridge = createCloudBridge({
      vercel: () => CONFIG,
      attachmentToken: () => 'stable-serve-token',
      capturePortable: async () => {
        captures.push(1)
        return PORTABLE
      },
      driverWith: () => driver,
    })

    await bridge.sandboxes.create({ threadId: THREAD, workspace: null })

    expect(captures).toHaveLength(1)
    expect(driver.written.map((write) => write.path)).toContain(
      '/atlas/home/bootstrap/local-state.json',
    )
  })
})
