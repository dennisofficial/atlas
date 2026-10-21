import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState } from '@dltech/atlas-harness'
import type { VercelSandboxConfig } from '@dltech/atlas-wire'
import { createCloudBridge, type BridgeDriver } from '../create-bridge'

const THREAD = toThreadId('brn_authorize')
const SERVE_URL = 'https://sb.vercel.run'
const CONFIG: VercelSandboxConfig = {
  credentials: { token: 'vercel-test-token', teamId: 'team_test', projectId: 'prj_test' },
  image: 'atlas-sandbox:test',
}

const recordingDriver = (args: { created: boolean; events: string[] }): BridgeDriver => {
  const sandbox = {
    runCommand: async () => ({ exitCode: args.created ? 1 : 0 }),
    domain: (port: number) => `https://sb-${port}.vercel.run`,
  }
  return {
    inspect: async () =>
      args.created ? undefined : { state: ECloudSandboxState.Running, url: SERVE_URL },
    createOrResume: async (createArgs) => {
      await createArgs.putContextOnFreshBoot?.(sandbox as never)
      args.events.push('launch')
      return {
        sessionId: 'session-1',
        url: SERVE_URL,
        state: ECloudSandboxState.Running,
        created: args.created,
        token: createArgs.token ?? 'driver-minted',
      }
    },
    writeBootstrapFileToSandbox: async (write) => {
      args.events.push(`write:${write.path.split('/').pop()}`)
    },
    writeBootstrapFile: async () => undefined,
    readResources: async () => ({}),
    updateResources: async () => undefined,
    destroy: async () => undefined,
  }
}

const bridgeWith = (args: {
  driver: BridgeDriver
  events: string[]
  authorizeSandbox?: (authorization: {
    threadId: string
    token: string
    serveUrl: string
    model?: string | undefined
  }) => Promise<void>
  registration?: boolean
}) =>
  createCloudBridge({
    vercel: () => CONFIG,
    attachmentToken: () => 'serve-token',
    ...(args.authorizeSandbox === undefined ? {} : { authorizeSandbox: args.authorizeSandbox }),
    ...(args.registration === true
      ? {
          registration: () => ({}),
          sendRegistration: () => {
            args.events.push('register')
          },
        }
      : {}),
    driverWith: () => args.driver,
  })

describe('createCloudBridge sandbox OAuth authorization', () => {
  it('authorizes against the sandbox domain before serve launches', async () => {
    const events: string[] = []
    const authorizations: unknown[] = []
    const bridge = bridgeWith({
      driver: recordingDriver({ created: true, events }),
      events,
      authorizeSandbox: async (authorization) => {
        events.push('authorize')
        authorizations.push(authorization)
      },
    })

    await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect(events.indexOf('authorize')).toBeLessThan(events.indexOf('launch'))
    expect(authorizations).toEqual([
      { threadId: THREAD, token: 'serve-token', serveUrl: 'https://sb-3000.vercel.run' },
    ])
  })

  it('authorizes even when the context capture callback is absent', async () => {
    const events: string[] = []
    const bridge = bridgeWith({
      driver: recordingDriver({ created: true, events }),
      events,
      authorizeSandbox: async () => {
        events.push('authorize')
      },
    })

    await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect(events.filter((event) => event === 'authorize')).toHaveLength(1)
  })

  it('aborts the birth before serve launches when authorization fails', async () => {
    const events: string[] = []
    const bridge = bridgeWith({
      driver: recordingDriver({ created: true, events }),
      events,
      registration: true,
      authorizeSandbox: async () => {
        throw new Error('Sign in to Atlas Cloud before a cloud birth carries OAuth accounts')
      },
    })

    await expect(bridge.sandboxes.create({ threadId: THREAD, projectId: null })).rejects.toThrow(
      'Sign in to Atlas Cloud',
    )

    expect(events).not.toContain('launch')
    expect(events).not.toContain('register')
  })

  it('re-authorizes a resume whose vault is already live', async () => {
    const events: string[] = []
    const authorize = async () => {
      events.push('authorize')
    }
    const bridge = bridgeWith({
      driver: recordingDriver({ created: false, events }),
      events,
      authorizeSandbox: authorize,
    })

    await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect(events).toContain('authorize')
    expect(events.indexOf('authorize')).toBeLessThan(events.indexOf('launch'))
  })

  it('re-authorizes when a wake re-creates a dropped channel\'s sandbox', async () => {
    const events: string[] = []
    const bridge = bridgeWith({
      driver: recordingDriver({ created: false, events }),
      events,
      authorizeSandbox: async () => {
        events.push('authorize')
      },
    })

    const woken = await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect({ url: woken.url, token: woken.token }).toEqual({ url: SERVE_URL, token: 'serve-token' })
    expect(events).toContain('authorize')
  })

  it('keeps an API-key-only birth independent of the callback', async () => {
    const events: string[] = []
    const bridge = bridgeWith({
      driver: recordingDriver({ created: true, events }),
      events,
      registration: true,
    })

    const sandbox = await bridge.sandboxes.create({ threadId: THREAD, projectId: null })

    expect(sandbox.state).toBe(ECloudSandboxState.Running)
    expect(events).toContain('launch')
  })

  it('forwards the thread model to authorization so a selected unusable login fails before launch', async () => {
    const events: string[] = []
    const authorizations: unknown[] = []
    const bridge = bridgeWith({
      driver: recordingDriver({ created: true, events }),
      events,
      authorizeSandbox: async (authorization) => {
        authorizations.push(authorization)
      },
    })

    await bridge.sandboxes.create({ threadId: THREAD, projectId: null, model: 'anthropic/claude-test' })

    expect(authorizations).toEqual([
      {
        threadId: THREAD,
        token: 'serve-token',
        serveUrl: 'https://sb-3000.vercel.run',
        model: 'anthropic/claude-test',
      },
    ])
  })
})
