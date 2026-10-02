import { afterEach, describe, expect, it } from 'bun:test'

import { EPortExposure, type EnvironmentCapabilities } from '@dltech/atlas-core'

import { EWorkspaceState, EWorkspaceStep, startServe } from '../index'

import { fakeServeApp } from './fakes'
import {
  CONTROL_PLANE,
  releaseServeSpec,
  startWithDriveSpec,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe', () => {
  it('reads the thread model off the workspace spec the laptop left on the drive', async () => {
    let composedWith: { ref: string; effort?: string | undefined } | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startWithDriveSpec({
      spec: { model: 'inference-net/kimi-k3-fast' },
      compose: async (args) => {
        composedWith = args.model
        return app
      },
    })

    expect(composedWith).toEqual({ ref: 'inference-net/kimi-k3-fast' })
    await handle.close()
  })

  it('prefers an explicit model over the thread store', async () => {
    let composedWith: { ref: string; effort?: string | undefined } | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      model: { ref: 'anthropic/claude-sonnet-4-5' },
      compose: async (args) => {
        composedWith = args.model
        return app
      },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: (async (_input: unknown) =>
        new Response(null, { status: 204 })) as unknown as typeof fetch,
    })

    expect(composedWith).toEqual({ ref: 'anthropic/claude-sonnet-4-5' })
    await handle.close()
  })

  it('composes with no model when the spec on the drive names none', async () => {
    let composedWith: { ref: string; effort?: string | undefined } | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startWithDriveSpec({
      compose: async (args) => {
        composedWith = args.model
        return app
      },
    })

    expect(composedWith).toBeUndefined()
    await handle.close()
  })

  it('hands the profile capabilities to compose when the readiness carries them', async () => {
    const capabilities: EnvironmentCapabilities = {
      canPush: true,
      gitIdentity: 'Operator <operator@example.com>',
      gpgSigning: true,
      dockerAvailable: false,
      persistentFs: true,
      serviceTtlSeconds: 1800,
      portExposure: EPortExposure.PublicDomain,
      failures: [],
    }
    let composedWith: EnvironmentCapabilities | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      compose: async (args) => {
        composedWith = args.capabilities
        return app
      },
      ensureWorkspace: async () => ({
        state: EWorkspaceState.Materialized,
        profile: { steps: [], capabilities },
      }),
      fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
    })

    expect(composedWith).toEqual(capabilities)
    await handle.close()
  })

  it('composes without capabilities when the workspace failed before profiling', async () => {
    let composed = false
    let composedWith: EnvironmentCapabilities | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      compose: async (args) => {
        composed = true
        composedWith = args.capabilities
        return app
      },
      ensureWorkspace: async () => ({
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'fatal: repository not found',
      }),
      fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
    })

    expect(composed).toBe(true)
    expect(composedWith).toBeUndefined()
    await handle.close()
  })
})
