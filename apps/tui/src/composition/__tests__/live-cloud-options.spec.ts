import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { dismissNotice } from '../../ui/notice-store'
import { liveBridgeOptionsFor } from '../live-cloud'
import type { AtlasApp } from '../compose'

afterEach(() => {
  dismissNotice()
})

const THREAD = toThreadId('brn_live_options')
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
      'cloudUrl',
      'environment',
      'lastEventSeq',
      'onDriverLog',
      'onRegistrationFailed',
      'projectIdOf',
      'registration',
      'sendRegistration',
      'vercel',
    ])
  })

  it('reports the local log head and hands over no settings', async () => {
    const { app } = fakeApp()

    const options = liveBridgeOptionsFor(app)

    expect(await options.lastEventSeq?.({ threadId: THREAD })).toBe(42)
    expect(options).not.toHaveProperty('settings')
  })

  it('authorizes through the app cloud service', async () => {
    const { app, calls } = fakeApp()

    const options = liveBridgeOptionsFor(app)
    await options.authorizeSandbox?.({ threadId: THREAD, token: 't', serveUrl: 'https://sb.test' })

    expect(calls).toEqual(['authorize'])
  })

  it('registers nothing while signed out', async () => {
    const { app } = fakeApp()

    expect(await liveBridgeOptionsFor(app).registration?.({ threadId: THREAD })).toBeUndefined()
  })
})
