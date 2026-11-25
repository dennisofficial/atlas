import { describe, expect, test } from 'bun:test'

import type { IPayloadState } from '../state'
import {
  createWebUpdater,
  EWebPayloadState,
  type IWebUpdaterPorts,
  WEB_MANIFEST_URL,
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
    const fake = fakePorts({
      state: { current: manifestOf().hash, appVersion: '1.0.0' },
      complete: [manifestOf().hash],
    })
    const updater = updaterOf(fake)
    const status = await updater.check()
    expect(status).toEqual({
      state: EWebPayloadState.Idle,
      hash: manifestOf().hash,
      builtAt: manifestOf().builtAt,
    })
    expect(fake.payloadFs.calls).toEqual([])
  })

  test('keeps an installed payload ready across later checks until it is applied', async () => {
    const fake = fakePorts()
    const updater = updaterOf(fake)
    await updater.check()
    await updater.check()
    expect(updater.status().state).toBe(EWebPayloadState.Ready)
    expect(updater.pending()).toBe(manifestOf().hash)
    updater.applied()
    expect((await updater.check()).state).toBe(EWebPayloadState.Idle)
  })

  test('reinstalls the current payload once the app itself has updated', async () => {
    const fake = fakePorts({
      state: { current: manifestOf().hash, appVersion: '0.9.0' },
      complete: [manifestOf().hash],
    })
    const updater = updaterOf(fake)
    expect((await updater.check()).state).toBe(EWebPayloadState.Ready)
    expect(updater.pending()).toBe(manifestOf().hash)
    expect(await updater.installedRoot()).toBe(manifestOf().hash)
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

  test('offers the next payload that arrives after a reload', async () => {
    const fake = fakePorts()
    const updater = updaterOf(fake)
    await updater.check()
    updater.applied()
    fake.setManifest(manifestOf({ hash: 'e'.repeat(16), artifact: 'web-eeeeeeeeeeeeeeee.tar.gz' }))
    expect((await updater.check()).state).toBe(EWebPayloadState.Ready)
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

  test('keeps the running payload while newer ones wait to be applied', async () => {
    const running = 'f'.repeat(16)
    const fake = fakePorts({
      state: { current: running, appVersion: '1.0.0' },
      complete: [running],
    })
    const updater = updaterOf(fake)
    expect(await updater.installedRoot()).toBe(running)
    for (const hash of ['e'.repeat(16), 'd'.repeat(16), 'c'.repeat(16)]) {
      fake.setManifest(manifestOf({ hash, artifact: `web-${hash}.tar.gz` }))
      await updater.check()
    }
    expect(fake.payloadFs.calls).not.toContain(`discard:${running}`)
    expect(fake.payloadFs.calls).toContain(`discard:${'e'.repeat(16)}`)
  })

  test('keeps the swapped-in payload and releases the one it replaced', async () => {
    const launched = 'f'.repeat(16)
    const swapped = 'e'.repeat(16)
    const fake = fakePorts({
      state: { current: launched, appVersion: '1.0.0' },
      complete: [launched],
    })
    const updater = updaterOf(fake)
    await updater.installedRoot()
    fake.setManifest(manifestOf({ hash: swapped, artifact: 'web-eeeeeeeeeeeeeeee.tar.gz' }))
    await updater.check()
    updater.applied()
    for (const hash of ['d'.repeat(16), 'c'.repeat(16)]) {
      fake.setManifest(manifestOf({ hash, artifact: `web-${hash}.tar.gz` }))
      await updater.check()
    }
    expect(fake.payloadFs.calls).not.toContain(`discard:${swapped}`)
    expect(fake.payloadFs.calls).toContain(`discard:${launched}`)
  })

  test('releases a launched payload that failed to start', async () => {
    const broken = 'f'.repeat(16)
    const fake = fakePorts({ state: { current: broken, appVersion: '1.0.0' }, complete: [broken] })
    const updater = updaterOf(fake)
    await updater.installedRoot()
    await updater.fail({ hash: broken })
    for (const hash of ['e'.repeat(16), 'd'.repeat(16)]) {
      fake.setManifest(manifestOf({ hash, artifact: `web-${hash}.tar.gz` }))
      await updater.check()
    }
    expect(fake.payloadFs.calls).toContain(`discard:${broken}`)
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

describe('WEB_MANIFEST_URL', () => {
  test('reads the manifest from the mirror, which outlives the repository owner and visibility', () => {
    expect(WEB_MANIFEST_URL).toBe(
      'https://install.byatlas.io/releases/download/web-ota/web-update.json',
    )
  })
})
