import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EAccountOrigin, EAuthKind, EAuthProvider, type ClockPort } from '@dltech/atlas-core'

import { capturePortableState, fileAccountStore, FileSecretsStore } from '@dltech/atlas-harness'
import { SecretCipher } from '@dltech/atlas-harness'

import { EPortableStateBoot, installPortableState } from '../portable-state'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

const homes: string[] = []
const bundles: string[] = []

const tempHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-portable-boot-'))
  homes.push(home)
  return home
}

const tempBundle = (): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'atlas-serve-bundle-')), 'local-state.json')
  bundles.push(path)
  return path
}

const storeAt = (home: string) =>
  fileAccountStore({ file: join(home, 'auth.json'), keyFile: join(home, 'key'), clock })

const seedSource = async (home: string): Promise<void> => {
  const store = storeAt(home)
  await store.add({
    provider: EAuthProvider.Anthropic,
    label: 'Anthropic (ANTHROPIC_API_KEY)',
    secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-ant-fake' },
    origin: EAccountOrigin.Environment,
    importedFrom: 'environment:ANTHROPIC_API_KEY',
  })
  const secrets = new FileSecretsStore({
    file: join(home, 'secrets.json'),
    cipher: new SecretCipher(join(home, 'key')),
  })
  secrets.write({ name: 'TAVILY_API_KEY', value: 'tvly-fake' })
  writeFileSync(join(home, 'settings.json'), '{"theme":"dark"}\n')
  writeFileSync(join(home, 'mcp.json'), '{"linear":{"transport":{"kind":"stdio","command":"fake"}}}\n')
}

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
  for (const bundle of bundles.splice(0, bundles.length)) {
    rmSync(join(bundle, '..'), { recursive: true, force: true })
  }
})

describe('installPortableState', () => {
  let heldAtlasHome: string | undefined

  beforeEach(() => {
    heldAtlasHome = process.env.ATLAS_HOME
  })

  afterEach(() => {
    if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
    else process.env.ATLAS_HOME = heldAtlasHome
  })

  it('installs the staged bundle into the serve home and removes the exact staging file', async () => {
    const source = tempHome()
    await seedSource(source)
    const state = await capturePortableState({ home: source })

    const target = tempHome()
    process.env.ATLAS_HOME = target
    const bundle = tempBundle()
    writeFileSync(bundle, JSON.stringify(state))

    const boot = await installPortableState({ path: bundle })

    expect(boot.kind).toBe(EPortableStateBoot.Installed)
    expect(existsSync(bundle)).toBe(false)

    const store = storeAt(target)
    const accounts = await store.list()
    expect(accounts.map((account) => account.label)).toEqual(['Anthropic (ANTHROPIC_API_KEY)'])
    const held = await store.read(accounts[0]!.id)
    expect(held?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-ant-fake' })
    expect(held?.origin).toBe(EAccountOrigin.Login)
    expect(held?.importedFrom).toBeUndefined()

    const secrets = new FileSecretsStore({
      file: join(target, 'secrets.json'),
      cipher: new SecretCipher(join(target, 'key')),
    })
    expect(secrets.read('TAVILY_API_KEY')).toBe('tvly-fake')
    expect(readFileSync(join(target, 'settings.json'), 'utf8')).toContain('"theme":"dark"')
    expect(readFileSync(join(target, 'mcp.json'), 'utf8')).toContain('linear')
  })

  it('keeps a live vault on resume instead of installing the stale staged one', async () => {
    const source = tempHome()
    await seedSource(source)
    const state = await capturePortableState({ home: source })

    const target = tempHome()
    process.env.ATLAS_HOME = target

    const live = storeAt(target)
    const rotated = await live.add({
      provider: EAuthProvider.Anthropic,
      label: 'Sandbox login',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-ant-sandbox-own' },
      origin: EAccountOrigin.Login,
    })

    const bundle = tempBundle()
    writeFileSync(bundle, JSON.stringify(state))
    const boot = await installPortableState({ path: bundle })

    expect(boot.kind).toBe(EPortableStateBoot.Installed)
    if (boot.kind === EPortableStateBoot.Installed) {
      expect(boot.install.skipped).toContain(join(target, 'auth.json'))
    }

    const accounts = await live.list()
    expect(accounts).toHaveLength(1)
    expect((await live.read(rotated.id))?.secret).toEqual({
      kind: EAuthKind.ApiKey,
      apiKey: 'sk-ant-sandbox-own',
    })
  })

  it('answers absent when the drive staged nothing, without touching the home', async () => {
    const target = tempHome()
    process.env.ATLAS_HOME = target

    const boot = await installPortableState({ path: join(tempBundle(), 'never-written.json') })

    expect(boot.kind).toBe(EPortableStateBoot.Absent)
    expect(existsSync(join(target, 'auth.json'))).toBe(false)
  })

  it('fails on a corrupt bundle, installs nothing, and removes the staging file', async () => {
    const target = tempHome()
    process.env.ATLAS_HOME = target

    const bundle = tempBundle()
    writeFileSync(bundle, '{"version":2,"vaultKeyHex":"not-hex"}')

    const boot = await installPortableState({ path: bundle })

    expect(boot.kind).toBe(EPortableStateBoot.Failed)
    if (boot.kind === EPortableStateBoot.Failed) {
      expect(boot.reason).toContain('re-lifts')
      expect(boot.reason).not.toContain('not-hex')
    }
    expect(existsSync(join(target, 'auth.json'))).toBe(false)
    expect(existsSync(join(target, 'key'))).toBe(false)
    expect(existsSync(bundle)).toBe(false)
  })

  it('fails on a non-JSON bundle and removes the staging file', async () => {
    const target = tempHome()
    process.env.ATLAS_HOME = target

    const bundle = tempBundle()
    writeFileSync(bundle, 'this is not json')

    const boot = await installPortableState({ path: bundle })

    expect(boot.kind).toBe(EPortableStateBoot.Failed)
    if (boot.kind === EPortableStateBoot.Failed) expect(boot.reason).toContain('not valid JSON')
    expect(existsSync(bundle)).toBe(false)
  })

  it('refuses to read a staging path that is not a regular file', async () => {
    const target = tempHome()
    process.env.ATLAS_HOME = target

    const parent = mkdtempSync(join(tmpdir(), 'atlas-serve-bundle-'))
    homes.push(parent)
    const directory = join(parent, 'staged-directory')
    mkdirSync(directory)

    const boot = await installPortableState({ path: directory })

    expect(boot.kind).toBe(EPortableStateBoot.Failed)
    if (boot.kind === EPortableStateBoot.Failed) expect(boot.reason).toContain('not a file')
    expect(existsSync(directory)).toBe(true)
  })

  it('answers cleanup-failed — installed with a warning — when the staging bundle will not delete', async () => {
    const source = tempHome()
    await seedSource(source)
    const state = await capturePortableState({ home: source })

    const target = tempHome()
    process.env.ATLAS_HOME = target

    const bundle = tempBundle()
    writeFileSync(bundle, JSON.stringify(state))
    chmodSync(bundle, 0o444)
    chmodSync(join(bundle, '..'), 0o555)

    const boot = await installPortableState({ path: bundle })

    chmodSync(join(bundle, '..'), 0o755)
    expect(boot.kind).toBe(EPortableStateBoot.CleanupFailed)
    if (boot.kind === EPortableStateBoot.CleanupFailed) {
      expect(boot.reason).toContain('would not delete')
      expect(boot.reason).not.toContain('sk-ant-fake')
      expect(boot.install.written.length).toBeGreaterThan(0)
    }
    expect(existsSync(join(target, 'auth.json'))).toBe(true)
  })
})
