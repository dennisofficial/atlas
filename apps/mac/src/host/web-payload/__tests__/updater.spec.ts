import { describe, expect, test } from 'bun:test'

import type { IPayloadState } from '../state'
import {
  createWebUpdater,
  EWebPayloadState,
  type IWebUpdaterPorts,
  QUIET_AFTER_RELOAD_MS,
} from '../updater'
import { fakePayloadFs, manifestOf } from './fixtures'

const archive = new Uint8Array([1, 2, 3])

function fakePorts({
  manifestInput = manifestOf() as unknown,
  state = {} as IPayloadState,
  complete = [] as string[],
  manifestError,
}: {
  manifestInput?: unknown
  state?: IPayloadState
  complete?: string[]
  manifestError?: Error
} = {}) {
  const payloadFs = fakePayloadFs({ state, complete })
  const logs: unknown[] = []
  const intervals: Array<() => void> = []
  let clock = 0
  let currentManifest = manifestInput
  const ports: IWebUpdaterPorts = {
    fs: payloadFs.fs,
    fetchJson: async () => {
      if (manifestError !== undefined) throw manifestError
      return currentManifest
    },
    download: async () => archive,
    sha256: () => manifestOf().sha256,
    log: ({ error }) => void logs.push(error),
    now: () => clock,
    setInterval: (handler) => {
      intervals.push(handler)
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: () => undefined,
  }
  return {
    ports,
    payloadFs,
    logs,
    intervals,
    setManifest: (next: unknown) => {
      currentManifest = next
    },
    advance: (ms: number) => {
      clock += ms
    },
  }
}

function updaterOf(fake: ReturnType<typeof fakePorts>) {
  return createWebUpdater({
    home: '/home',
    manifestUrl: 'https://example.com/web-update.json',
    contract: 1,
    appVersion: '1.0.0',
    ports: fake.ports,
  })
}

describe('createWebUpdater', () => {
  test('installs a newer payload and reports it ready', async () => {
    const fake = fakePorts({ state: { current: 'f'.repeat(16) } })
    const updater = updaterOf(fake)
    const status = await updater.check()
    expect(status.state).toBe(EWebPayloadState.Ready)
    expect(status.hash).toBe(manifestOf().hash)
    expect(updater.pending()).toBe(manifestOf().hash)
    expect(fake.payloadFs.state().current).toBe(manifestOf().hash)
  })

  test('reports the version the payload was built as', async () => {
    const fake = fakePorts({ manifestInput: manifestOf({ version: '1.294.0' }) })
    const updater = updaterOf(fake)
    const status = await updater.check()
    expect(status.state).toBe(EWebPayloadState.Ready)
    expect(status.version).toBe('1.294.0')
  })

  test('does no work when the payload is already current', async () => {
    const fake = fakePorts({ state: { current: manifestOf().hash }, complete: [manifestOf().hash] })
    const updater = updaterOf(fake)
    const status = await updater.check()
    expect(status).toEqual({
      state: EWebPayloadState.Idle,
      hash: manifestOf().hash,
      builtAt: manifestOf().builtAt,
    })
    expect(fake.payloadFs.calls).toEqual([])
  })

  test('refuses a payload that needs a newer app', async () => {
    const fake = fakePorts({ manifestInput: manifestOf({ requiresShell: 2 }) })
    const updater = updaterOf(fake)
    expect(await updater.check()).toEqual({
      state: EWebPayloadState.Idle,
      error: 'this payload needs a newer Atlas app',
    })
    expect(fake.payloadFs.calls).toEqual([])
  })

  test('reports an invalid manifest without touching the disk', async () => {
    const fake = fakePorts({ manifestInput: { schemaVersion: 9 } })
    const updater = updaterOf(fake)
    expect(await updater.check()).toEqual({
      state: EWebPayloadState.Idle,
      error: 'the update manifest is invalid',
    })
  })

  test('survives a check that cannot reach the network', async () => {
    const fake = fakePorts({ manifestError: new Error('offline') })
    const updater = updaterOf(fake)
    const status = await updater.check()
    expect(status).toEqual({ state: EWebPayloadState.Idle, error: 'offline' })
    expect(fake.logs).toHaveLength(1)
  })

  test('marks a payload that failed to start so it is never selected again', async () => {
    const fake = fakePorts()
    const updater = updaterOf(fake)
    await updater.check()
    await updater.fail({ hash: manifestOf().hash })
    expect(fake.payloadFs.state().failed).toBe(manifestOf().hash)
    expect(updater.pending()).toBeUndefined()
    expect(await updater.installedRoot()).toBeUndefined()
  })

  test('ignores a payload installed by a different app version', async () => {
    const fake = fakePorts({
      state: { current: manifestOf().hash, appVersion: '0.9.0' },
      complete: [manifestOf().hash],
    })
    const updater = updaterOf(fake)
    expect(await updater.installedRoot()).toBeUndefined()
  })

  test('serves a payload installed by this app version', async () => {
    const fake = fakePorts({
      state: { current: manifestOf().hash, appVersion: '1.0.0' },
      complete: [manifestOf().hash],
    })
    const updater = updaterOf(fake)
    expect(await updater.installedRoot()).toBe(manifestOf().hash)
  })

  test('clears the ready state once the payload has been reloaded', async () => {
    const fake = fakePorts()
    const updater = updaterOf(fake)
    await updater.check()
    expect(updater.status().state).toBe(EWebPayloadState.Ready)
    updater.applied()
    expect(updater.status().state).toBe(EWebPayloadState.Idle)
    expect(updater.pending()).toBeUndefined()
  })

  test('stays quiet for the quiet window after a reload, then speaks again', async () => {
    const fake = fakePorts()
    const updater = updaterOf(fake)
    await updater.check()
    updater.applied()
    const newer = manifestOf({ hash: 'e'.repeat(16), artifact: 'web-eeeeeeeeeeeeeeee.tar.gz' })
    fake.setManifest(newer)

    expect((await updater.check()).state).toBe(EWebPayloadState.Idle)
    expect(updater.pending()).toBe(newer.hash)

    fake.advance(QUIET_AFTER_RELOAD_MS)
    fake.setManifest(manifestOf({ hash: 'd'.repeat(16), artifact: 'web-dddddddddddddddd.tar.gz' }))
    expect((await updater.check()).state).toBe(EWebPayloadState.Ready)
  })

  test('never speaks about a payload it installed during the quiet window', async () => {
    const fake = fakePorts()
    const updater = updaterOf(fake)
    await updater.check()
    updater.applied()
    fake.setManifest(manifestOf({ hash: 'e'.repeat(16), artifact: 'web-eeeeeeeeeeeeeeee.tar.gz' }))
    expect((await updater.check()).state).toBe(EWebPayloadState.Idle)
    fake.advance(QUIET_AFTER_RELOAD_MS)
    expect((await updater.check()).state).toBe(EWebPayloadState.Idle)
  })

  test('names a pending payload even inside the quiet window when asked', async () => {
    const fake = fakePorts()
    const updater = updaterOf(fake)
    await updater.check()
    updater.applied()
    fake.setManifest(manifestOf({ hash: 'e'.repeat(16), artifact: 'web-eeeeeeeeeeeeeeee.tar.gz' }))
    expect((await updater.check({ force: true })).state).toBe(EWebPayloadState.Ready)
  })

  test('prunes payloads the state no longer points at', async () => {
    const fake = fakePorts({
      state: { current: 'f'.repeat(16) },
      complete: ['f'.repeat(16), 'e'.repeat(16)],
    })
    const updater = updaterOf(fake)
    await updater.check()
    expect(fake.payloadFs.calls).toContain(`discard:${'e'.repeat(16)}`)
  })

  test('checks on launch and on the interval, and stops on request', async () => {
    const fake = fakePorts()
    const updater = updaterOf(fake)
    updater.start()
    updater.start()
    expect(fake.intervals).toHaveLength(1)
    updater.stop()
    updater.stop()
    expect(fake.intervals).toHaveLength(1)
  })
})
