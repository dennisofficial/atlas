import { afterEach, describe, expect, it } from 'bun:test'

import { EWorkspaceState, startServe } from '../index'

import { fakeServeApp } from './fakes'
import {
  CONTROL_PLANE,
  releaseServeSpec,
  startWithHomeSpec,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe', () => {
  it('reads the thread model off the workspace spec the laptop left in the Atlas home', async () => {
    let composedWith: { ref: string; effort?: string | undefined } | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startWithHomeSpec({
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

  it('composes with no model when the spec in the Atlas home names none', async () => {
    let composedWith: { ref: string; effort?: string | undefined } | undefined
    const app = fakeServeApp({ threadId, root: '/workspace' })

    const handle = await startWithHomeSpec({
      compose: async (args) => {
        composedWith = args.model
        return app
      },
    })

    expect(composedWith).toBeUndefined()
    await handle.close()
  })
})
