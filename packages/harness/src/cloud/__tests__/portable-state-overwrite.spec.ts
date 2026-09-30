import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'
import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { fileAccountStore } from '../../credentials/account-store'
import { SecretCipher } from '../../credentials/secret-cipher'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { SystemClock } from '../../store/clock'
import { capturePortableState, materializePortableState } from '../portable-state'

const storesAt = (home: string) => ({
  accounts: fileAccountStore({
    file: join(home, 'auth.json'),
    keyFile: join(home, 'key'),
    clock: new SystemClock(),
  }),
  secrets: new FileSecretsStore({
    file: join(home, 'secrets.json'),
    cipher: new SecretCipher(join(home, 'key')),
  }),
})

describe('explicit portable-state replacement', () => {
  it('seals accounts and secrets with the same replacement key it writes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-portable-replacement-'))
    try {
      const sourceHome = join(directory, 'source')
      const targetHome = join(directory, 'target')
      const source = storesAt(sourceHome)
      const target = storesAt(targetHome)
      const draft = {
        provider: EAuthProvider.Anthropic,
        origin: EAccountOrigin.Login,
        label: 'synthetic API account',
        secret: { kind: EAuthKind.ApiKey, apiKey: 'fake-key-one' },
      } as const
      const account = await source.accounts.add(draft)
      source.secrets.write({ name: 'search.test', value: 'fake-search-one' })

      await materializePortableState({
        state: await capturePortableState({ home: sourceHome }),
        home: targetHome,
      })
      expect((await target.accounts.read(account.id))?.secret).toEqual(draft.secret)

      const nextSecret = { kind: EAuthKind.ApiKey, apiKey: 'fake-key-two' } as const
      await source.accounts.replaceSecret({ accountId: account.id, secret: nextSecret })
      source.secrets.write({ name: 'search.test', value: 'fake-search-two' })
      await materializePortableState({
        state: await capturePortableState({ home: sourceHome }),
        home: targetHome,
        overwriteExisting: true,
      })

      const restarted = storesAt(targetHome)
      expect((await restarted.accounts.read(account.id))?.secret).toEqual(nextSecret)
      expect(restarted.secrets.read('search.test')).toBe('fake-search-two')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
