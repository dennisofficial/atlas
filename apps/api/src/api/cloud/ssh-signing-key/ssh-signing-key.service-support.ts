import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { sharedSigningKeyDb } from '../../../../test/fake-signing-key-db.js'
import { GithubDeviceClient } from '../github/github-device-client'
import { GithubService } from '../github/github.service'
import { GithubSigningKeysClient } from './github-signing-keys.client'
import { createFakeGithub } from './ssh-signing-key.fakes'
import { generateKey } from './ssh-key.fixtures'
import { SshSigningKeyService } from './ssh-signing-key.service'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

export const USER = 'user-a'
export const SIGNING_SCOPES = 'repo read:org admin:repo_hook admin:ssh_signing_key'
export const OLD_SCOPES = 'repo read:org admin:repo_hook'
export const GITHUB_API = 'https://api.github.com'
export const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
export const github = createFakeGithub()
export const fake = sharedSigningKeyDb
export const keyA = generateKey({ type: 'ed25519' })
export const keyB = generateKey({ type: 'ed25519' })

export const connect = (scopes: string) =>
  fake.connections.push({
    userId: USER,
    login: 'octocat',
    scopes,
    sealedToken: cipher.encrypt('gho_token'),
  })

export function resetWorld(): SshSigningKeyService {
  fake.reset()
  github.reset()
  connect(SIGNING_SCOPES)
  return new SshSigningKeyService(
    cipher,
    new GithubService(cipher, new EnvService({}), new GithubDeviceClient({})),
    new GithubSigningKeysClient({ fetchFn: github.fetchFn }),
  )
}

export const deletedIds = (): string[] =>
  github.calls
    .filter((call) => call.method === 'DELETE')
    .map((call) => call.url.split('/').pop() ?? '')
