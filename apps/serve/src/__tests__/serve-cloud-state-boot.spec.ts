import { afterEach, describe, expect, it } from 'vitest'

import { EWorkspaceState, startServe } from '../index'
import { EServeEvent } from '../serve-log'

import { fakeServeApp } from './fakes'
import { CONTROL_PLANE, releaseServeSpec, threadId, TOKEN } from './serve-spec-fixture'

afterEach(releaseServeSpec)

const BOOT_CEILING_MS = 5_000

const unreachable = (async () => {
  throw new TypeError('getaddrinfo ENOTFOUND api.example.com')
}) as unknown as typeof fetch

describe('serve boot against an unreachable Atlas Cloud', () => {
  it('fails the cloud-state pull fast, logs it, and still composes', async () => {
    const lines: string[] = []
    let composed = false
    const startedAt = Date.now()

    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: {},
      cwd: '/workspace',
      write: (line) => lines.push(line),
      compose: async () => {
        composed = true
        return fakeServeApp({ threadId, root: '/workspace' })
      },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: unreachable,
    })

    expect(Date.now() - startedAt).toBeLessThan(BOOT_CEILING_MS)
    expect(composed).toBe(true)
    expect(lines.some((line) => line.includes(EServeEvent.CloudStateFailed))).toBe(true)
    expect(lines.some((line) => line.includes(EServeEvent.CloudStateReady))).toBe(false)
    await handle.close()
  })
})
