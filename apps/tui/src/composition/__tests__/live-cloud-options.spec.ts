import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { PortableState } from '@dltech/atlas-wire'

import { liveBridgeOptionsFor } from '../live-cloud'
import type { AtlasApp } from '../compose'

const THREAD = toThreadId('brn_live_options')
const PORTABLE: PortableState = {
  version: 1,
  vaultKeyHex: 'ab'.repeat(32),
  accounts: [],
  active: [],
  secrets: [],
}

const fakeApp = () => {
  const calls: string[] = []
  const log = { head: async () => 42 }
  const settings = { snapshot: () => ({ resolution: { settings: new Map() } }) }
  const app = {
    log,
    settings,
    secrets: {},
    cloud: {
      session: () => null,
      capturePortableState: async () => {
        calls.push('capture')
        return PORTABLE
      },
      prepareSandboxOauth: async () => {
        calls.push('authorize')
      },
    },
  } as unknown as AtlasApp
  return { app, calls, log, settings }
}

describe('liveBridgeOptionsFor', () => {
  it('carries every option the production bridge runs with', () => {
    const { app } = fakeApp()

    const options = liveBridgeOptionsFor(app)

    expect(Object.keys(options).sort()).toEqual([
      'attachmentToken',
      'authorizeSandbox',
      'capturePortable',
      'cloudUrl',
      'environment',
      'lastEventSeq',
      'localLog',
      'onDriverLog',
      'onMirrorFailed',
      'onPortableOmitted',
      'onRegistrationFailed',
      'readGitToken',
      'registration',
      'sendRegistration',
      'settings',
      'vercel',
    ])
  })

  it('reports the local log head and hands the mirror the app log', async () => {
    const { app, log, settings } = fakeApp()

    const options = liveBridgeOptionsFor(app)

    expect(await options.lastEventSeq?.({ threadId: THREAD })).toBe(42)
    expect(options.localLog).toBe(log as never)
    expect(options.settings).toBe(settings as never)
  })

  it('captures and authorizes through the app cloud service', async () => {
    const { app, calls } = fakeApp()

    const options = liveBridgeOptionsFor(app)
    await options.capturePortable?.()
    await options.authorizeSandbox?.({ threadId: THREAD, token: 't', serveUrl: 'https://sb.test' })

    expect(calls).toEqual(['capture', 'authorize'])
  })

  it('registers nothing while signed out', async () => {
    const { app } = fakeApp()

    expect(await liveBridgeOptionsFor(app).registration?.({ threadId: THREAD })).toBeUndefined()
  })
})
