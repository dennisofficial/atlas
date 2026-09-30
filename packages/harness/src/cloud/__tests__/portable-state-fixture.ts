import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  type ClockPort,
} from '@dltech/atlas-core'

import { fileAccountStore, type AccountStore } from '../../credentials/account-store'
import { SecretCipher } from '../../credentials/secret-cipher'
import { FileSecretsStore } from '../../secrets/file-secrets-store'

export const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

export const OAUTH_TOKENS = {
  accessToken: 'fake-access-token',
  refreshToken: 'fake-refresh-token',
  expiresAt: '2026-06-01T00:00:00.000Z',
}

export type PortableHome = {
  directory: string
  store: AccountStore
  cipher: SecretCipher
}

export const openHome = (): PortableHome => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-portable-'))
  const store = fileAccountStore({
    file: join(directory, 'auth.json'),
    keyFile: join(directory, 'key'),
    clock,
  })
  return { directory, store, cipher: new SecretCipher(join(directory, 'key')) }
}

export const seedSource = async ({
  source,
}: {
  source: PortableHome
}): Promise<{ envAccountId: string; oauthAccountId: string }> => {
  const oauth = await source.store.add({
    provider: EAuthProvider.Anthropic,
    label: 'Claude subscription',
    secret: { kind: EAuthKind.Oauth, tokens: OAUTH_TOKENS },
    origin: EAccountOrigin.Imported,
    importedFrom: 'claude-code',
    subscription: 'max',
  })
  const env = await source.store.add({
    provider: EAuthProvider.OpenAI,
    label: 'OpenAI (OPENAI_API_KEY)',
    secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-fake-env-key' },
    origin: EAccountOrigin.Environment,
    importedFrom: 'environment:OPENAI_API_KEY',
  })
  const apiKey = await source.store.add({
    provider: EAuthProvider.OpenRouter,
    label: 'OpenRouter',
    secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-or-fake' },
    origin: EAccountOrigin.Login,
  })
  await source.store.setActive({ provider: EAuthProvider.Anthropic, accountId: oauth.id })
  await source.store.setActive({ provider: EAuthProvider.OpenAI, accountId: env.id })

  const secrets = new FileSecretsStore({
    file: join(source.directory, 'secrets.json'),
    cipher: source.cipher,
  })
  secrets.write({ name: 'LINEAR_API_KEY', value: 'lin_fake_value' })
  secrets.write({ name: 'mcp-oauth:linear', value: '{"refreshToken":"fake-mcp-refresh"}' })
  secrets.write({ name: 'sandbox-serve:th_fake_thread', value: 'fake-attachment-token' })

  writeFileSync(join(source.directory, 'settings.json'), '{"theme":"dark"}\n')
  writeFileSync(
    join(source.directory, 'mcp.json'),
    '{"linear":{"transport":{"kind":"stdio","command":"fake-mcp-server"}}}\n',
  )

  void apiKey
  return { envAccountId: env.id, oauthAccountId: oauth.id }
}

export const openSecrets = ({ home }: { home: PortableHome }): FileSecretsStore =>
  new FileSecretsStore({
    file: join(home.directory, 'secrets.json'),
    cipher: new SecretCipher(join(home.directory, 'key')),
  })
