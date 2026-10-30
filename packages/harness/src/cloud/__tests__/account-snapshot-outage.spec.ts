import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EAuthProvider, type ClockPort } from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { AccountStoreProxy } from '../account-store-proxy'
import { CloudSessionStore } from '../cloud-session'
import { SealedSnapshotFile } from '../sealed-snapshot-file'
import { startFakeAccountCloud, type FakeAccountCloud } from './fake-account-cloud'

const clock: ClockPort = { now: () => new Date().toISOString() }

let directory: string
let cloud: FakeAccountCloud

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-snapshot-outage-'))
  cloud = startFakeAccountCloud()
  cloud.accounts.push({
    id: 'acc_cloud_1',
    provider: EAuthProvider.Anthropic,
    kind: 'api-key',
    origin: 'login',
    label: 'cloud key',
    status: 'active',
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    secret: { kind: 'api-key', apiKey: 'sk-cloud' },
  })
  cloud.actives.set(EAuthProvider.Anthropic, 'acc_cloud_1')
})

afterEach(() => {
  cloud.stop()
  rmSync(directory, { recursive: true, force: true })
})

const sessionsAt = () =>
  new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })

const snapshotFile = () =>
  new SealedSnapshotFile({
    file: join(directory, 'accounts-cache.json'),
    keyFile: join(directory, 'key'),
  })

const proxyOver = (sessions: CloudSessionStore) =>
  new AccountStoreProxy({
    local: memoryAccountStore({ clock }),
    sessions,
    clock,
    snapshotFile: snapshotFile(),
  })

describe('a signed-in process started while Atlas Cloud is down', () => {
  it('serves the inventory and secret the cloud last gave, from the sealed snapshot', async () => {
    const sessions = sessionsAt()
    sessions.write({ url: cloud.url, token: 'fake-session', email: null })
    const warm = proxyOver(sessions)
    await warm.list()
    await warm.read('acc_cloud_1' as never)
    await warm.activeFor(EAuthProvider.Anthropic)

    cloud.failOn.add('accounts.list')
    cloud.failOn.add('accounts.get')
    cloud.failOn.add('accounts.active')
    const cold = proxyOver(sessions)

    expect((await cold.list()).map((account) => account.id)).toEqual(['acc_cloud_1'] as never)
    expect((await cold.read('acc_cloud_1' as never))?.secret).toEqual({
      kind: 'api-key',
      apiKey: 'sk-cloud',
    } as never)
    expect(await cold.activeFor(EAuthProvider.Anthropic)).toBe('acc_cloud_1' as never)
  }, 30_000)

  it('drops the snapshot on sign-out so no cloud account outlives the session', async () => {
    const sessions = sessionsAt()
    sessions.write({ url: cloud.url, token: 'fake-session', email: null })
    await proxyOver(sessions).list()
    expect(existsSync(join(directory, 'accounts-cache.json'))).toBe(true)

    sessions.clear()

    expect(existsSync(join(directory, 'accounts-cache.json'))).toBe(false)
  })

  it('ignores a snapshot written for another Atlas Cloud', async () => {
    snapshotFile().write({
      url: 'https://elsewhere.test',
      value: { list: [], stored: {}, active: {} },
    })
    const sessions = sessionsAt()
    sessions.write({ url: cloud.url, token: 'fake-session', email: null })
    cloud.failOn.add('accounts.list')

    await expect(proxyOver(sessions).list()).rejects.toThrow()
  }, 30_000)
})
