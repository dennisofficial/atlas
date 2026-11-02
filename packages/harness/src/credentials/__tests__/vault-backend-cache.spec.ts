import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  ECredentialAvailability,
  revisionOf,
  type AccountId,
  type AvailabilityKey,
  type ClockPort,
} from '@dltech/atlas-core'

import { fileAccountStore } from '../account-store'
import { InMemoryCredentialAvailability } from '../credential-availability'
import { fileVaultBackend } from '../vault-backend'

const clock: ClockPort = { now: () => '2026-11-02T12:00:00.000Z' }

let directory: string
let file: string
let keyFile: string

const storeOnFile = () => fileAccountStore({ file, keyFile, clock })

const addAccount = (store: ReturnType<typeof storeOnFile>) =>
  store.add({
    provider: EAuthProvider.Anthropic,
    label: 'work',
    secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-test' },
    origin: EAccountOrigin.Login,
  })

const authorityReading = (store: ReturnType<typeof storeOnFile>) =>
  new InMemoryCredentialAvailability({
    clock,
    manualPausedAt: async (accountId: AccountId) =>
      (await store.list()).find((account) => account.id === accountId)?.manuallyPausedAt ?? null,
  })

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-vault-cache-'))
  file = join(directory, 'auth.json')
  keyFile = join(directory, 'key')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('the file vault read cache', () => {
  it('serves an unchanged file without parsing it again', async () => {
    const store = storeOnFile()
    await addAccount(store)
    const backend = fileVaultBackend(file)

    expect(backend.load()).toBe(backend.load())
  })

  it('reloads after this backend saves', async () => {
    const backend = fileVaultBackend(file)
    const before = backend.load()

    backend.save({ ...before, active: {} })

    expect(backend.load()).not.toBe(before)
  })

  it('reloads after another store on the same file writes', async () => {
    const backend = fileVaultBackend(file)
    await addAccount(storeOnFile())
    expect(backend.load().accounts).toHaveLength(1)

    await addAccount(storeOnFile())

    expect(backend.load().accounts).toHaveLength(2)
  })

  it('reads a vault deleted after being cached as empty', async () => {
    await addAccount(storeOnFile())
    const backend = fileVaultBackend(file)
    expect(backend.load().accounts).toHaveLength(1)

    rmSync(file)

    expect(backend.load().accounts).toEqual([])
  })
})

describe('a manual pause read through the cached vault', () => {
  const keyOf = (accountId: AccountId): AvailabilityKey => ({
    accountId,
    providerId: 'anthropic',
    modelId: 'claude-opus-5',
  })

  it('holds before the first admission', async () => {
    const store = storeOnFile()
    const account = await addAccount(store)
    await store.setManualPause({ accountId: account.id, paused: true })
    const authority = authorityReading(storeOnFile())
    const revision = revisionOf((await store.read(account.id))!)

    const decision = await authority.admit({ key: keyOf(account.id), revision })

    expect(decision.admitted).toBe(false)
  })

  it('applies a pause set by another process after earlier admissions warmed the cache', async () => {
    const mine = storeOnFile()
    const account = await addAccount(mine)
    const authority = authorityReading(mine)
    const revision = revisionOf((await mine.read(account.id))!)
    const key = keyOf(account.id)
    expect((await authority.admit({ key, revision })).admitted).toBe(true)

    await storeOnFile().setManualPause({ accountId: account.id, paused: true })

    expect((await authority.admit({ key, revision })).admitted).toBe(false)
    expect((await authority.inspect({ key, revision })).availability).toBe(
      ECredentialAvailability.Paused,
    )
  })

  it('lifts when another process removes the pause', async () => {
    const mine = storeOnFile()
    const account = await addAccount(mine)
    await mine.setManualPause({ accountId: account.id, paused: true })
    const authority = authorityReading(mine)
    const revision = revisionOf((await mine.read(account.id))!)
    const key = keyOf(account.id)
    expect((await authority.admit({ key, revision })).admitted).toBe(false)

    await storeOnFile().setManualPause({ accountId: account.id, paused: false })

    expect((await authority.admit({ key, revision })).admitted).toBe(true)
  })
})
