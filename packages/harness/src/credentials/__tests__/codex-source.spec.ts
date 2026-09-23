import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { CodexSource, CODEX_SOURCE_ID, importCodexAccount } from '../codex-source'
import {
  FAKE_CODEX_ACCOUNT_ID,
  FAKE_CODEX_EXPIRY_EPOCH_SECONDS,
  FAKE_CODEX_REFRESH_TOKEN,
  fakeCodexAccessToken,
  fakeCodexAuthPayload,
  fakeCodexIdToken,
  fakeJwt,
} from './fixtures'
import { movableClock, oauthSecret, openVault, tokens, type Vault } from './vault-fixture'

let directory: string
let file: string
let vault: Vault

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-codex-source-'))
  file = join(directory, 'auth.json')
  vault = openVault(movableClock())
})

afterEach(() => {
  vault.close()
  rmSync(directory, { recursive: true, force: true })
})

const sourceHolding = (payload: string | undefined): CodexSource => {
  if (payload !== undefined) writeFileSync(file, payload, { mode: 0o600 })
  return new CodexSource({ file })
}

describe('CodexSource', () => {
  it('reads the whole pair, refresh token and account id included', async () => {
    const source = sourceHolding(fakeCodexAuthPayload())

    expect(await source.read()).toEqual({
      accessToken: fakeCodexAccessToken(),
      refreshToken: FAKE_CODEX_REFRESH_TOKEN,
      expiresAt: new Date(FAKE_CODEX_EXPIRY_EPOCH_SECONDS * 1000).toISOString(),
      accountId: FAKE_CODEX_ACCOUNT_ID,
    })
  })

  it('is empty rather than broken when Codex has never signed in', async () => {
    expect(await sourceHolding(undefined).read()).toBeUndefined()
  })

  it('treats a payload it cannot parse as no credential at all', async () => {
    expect(await sourceHolding('{ not json').read()).toBeUndefined()
  })

  it('ignores an API-key login, which carries no OAuth pair', async () => {
    expect(await sourceHolding(fakeCodexAuthPayload({ tokens: null })).read()).toBeUndefined()
  })

  it('treats an access token with no expiry claim as no credential at all', async () => {
    const source = sourceHolding(fakeCodexAuthPayload({ accessToken: fakeJwt({}) }))

    expect(await source.read()).toBeUndefined()
  })

  it('writes a rotated pair back in the shape Codex reads, preserving the rest of the file', async () => {
    const source = sourceHolding(fakeCodexAuthPayload())

    await source.write(
      tokens({
        access: 'rotated-access',
        refresh: 'rotated-refresh',
        accountId: FAKE_CODEX_ACCOUNT_ID,
      }),
    )

    const written = JSON.parse(readFileSync(file, 'utf8')) as {
      auth_mode: string
      tokens: {
        id_token: string
        access_token: string
        refresh_token: string
        account_id: string
      }
      last_refresh: string
    }

    expect(written.auth_mode).toBe('chatgpt')
    expect(written.tokens.access_token).toBe('rotated-access')
    expect(written.tokens.refresh_token).toBe('rotated-refresh')
    expect(written.tokens.account_id).toBe(FAKE_CODEX_ACCOUNT_ID)
    expect(written.tokens.id_token).toBe(fakeCodexIdToken())
    expect(Number.isNaN(Date.parse(written.last_refresh))).toBe(false)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('round-trips through its own writer', async () => {
    const source = sourceHolding(fakeCodexAuthPayload())

    await source.write(
      tokens({ access: fakeCodexAccessToken(), refresh: 'rotated-refresh' }),
    )

    expect(await source.read()).toMatchObject({
      accessToken: fakeCodexAccessToken(),
      refreshToken: 'rotated-refresh',
    })
  })
})

describe('importCodexAccount', () => {
  it('adopts an existing Codex login so the operator never sees a login screen', async () => {
    const source = sourceHolding(fakeCodexAuthPayload())

    const imported = await importCodexAccount({ accounts: vault.store, source })

    expect(imported?.origin).toBe(EAccountOrigin.Imported)
    expect(imported?.importedFrom).toBe(CODEX_SOURCE_ID)
    expect(imported?.provider).toBe(EAuthProvider.OpenAI)
    expect(imported?.kind).toBe(EAuthKind.Oauth)
    expect(imported?.label).toBe('Codex (pro)')
    expect(imported?.email).toBe('dennis@example.com')
    expect((await vault.store.read(imported!.id))?.secret).toMatchObject({
      kind: EAuthKind.Oauth,
      tokens: {
        refreshToken: FAKE_CODEX_REFRESH_TOKEN,
        accountId: FAKE_CODEX_ACCOUNT_ID,
      },
    })
  })

  it('falls back to the id token for the account id the file omits', async () => {
    writeFileSync(
      file,
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: fakeCodexIdToken(),
          access_token: fakeCodexAccessToken(),
          refresh_token: FAKE_CODEX_REFRESH_TOKEN,
        },
      }),
    )

    const imported = await importCodexAccount({
      accounts: vault.store,
      source: new CodexSource({ file }),
    })

    expect((await vault.store.read(imported!.id))?.secret).toMatchObject({
      kind: EAuthKind.Oauth,
      tokens: { accountId: FAKE_CODEX_ACCOUNT_ID },
    })
  })

  it('imports once, so a credential the operator removed does not come back', async () => {
    const source = sourceHolding(fakeCodexAuthPayload())

    const first = await importCodexAccount({ accounts: vault.store, source })
    const second = await importCodexAccount({ accounts: vault.store, source })

    expect(first).toBeDefined()
    expect(second).toBeUndefined()
    expect(await vault.store.list()).toHaveLength(1)
  })

  it('leaves a vault that already holds its own login alone', async () => {
    await vault.addAccount({ label: 'own', secret: oauthSecret({}) })
    const source = sourceHolding(undefined)

    expect(await importCodexAccount({ accounts: vault.store, source })).toBeUndefined()
    expect(await vault.store.list()).toHaveLength(1)
  })
})
