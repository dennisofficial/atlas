import { afterEach, describe, expect, it } from 'bun:test'

import { ENoticeTone, toThreadId } from '@dltech/atlas-core'
import type { PortableState } from '@dltech/atlas-wire'

import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { liveBridgeOptionsFor } from '../live-cloud'
import type { AtlasApp } from '../compose'

afterEach(() => {
  dismissNotice()
})

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
      'onMirrorRecovered',
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

  it('reports the mirror failure under one stable key, so repeats replace rather than stack', () => {
    const { app } = fakeApp()
    const options = liveBridgeOptionsFor(app)

    options.onMirrorFailed?.(new Error('wire died'))
    options.onMirrorFailed?.(new Error('wire died again'))

    const standing = currentNotices().filter((notice) => notice.key === 'mirror-out-of-sync')
    expect(standing).toHaveLength(1)
    expect(standing[0]?.tone).toBe(ENoticeTone.Info)
  })

  it('clears the mirror notice when the mirror reports it recovered', () => {
    const { app } = fakeApp()
    const options = liveBridgeOptionsFor(app)

    options.onMirrorFailed?.(new Error('wire died'))
    expect(currentNotices().some((notice) => notice.key === 'mirror-out-of-sync')).toBe(true)

    options.onMirrorRecovered?.()
    expect(currentNotices().some((notice) => notice.key === 'mirror-out-of-sync')).toBe(false)
  })

  it('tells the operator the live conversation is unaffected and the banner clears itself', () => {
    const { app } = fakeApp()

    liveBridgeOptionsFor(app).onMirrorFailed?.(new Error('wire died'))

    const posted = currentNotices().find((notice) => notice.key === 'mirror-out-of-sync')
    expect(posted?.text).toContain('briefly behind')
    expect(posted?.text).toContain('live view is unaffected')
    expect(posted?.text).toContain('clears itself')
  })
})
