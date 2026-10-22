import { db, sharedPool } from '@dltech/atlas-db'
import { seedUser } from '@dltech/atlas-db/testing'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
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
export const keyA = generateKey({ type: 'ed25519' })
export const keyB = generateKey({ type: 'ed25519' })

export type FailableOperation = 'create' | 'updateMany' | 'deleteMany'

const TRIGGER_EVENT: Record<FailableOperation, string> = {
  create: 'INSERT',
  updateMany: 'UPDATE',
  deleteMany: 'DELETE',
}

export const keys = () => db.orm.public.SshSigningKey.all()

export async function connect(args: { scopes: string; userId?: string }): Promise<void> {
  const userId = args.userId ?? USER
  await db.orm.public.GithubConnection.create({
    id: `ghc_${userId}`,
    userId,
    login: 'octocat',
    scopes: args.scopes,
    sealedToken: cipher.encrypt('gho_token'),
  })
}

export async function disconnect(): Promise<void> {
  await db.orm.public.GithubConnection.where({ userId: USER }).deleteAndCount()
}

export async function failNext(operation: FailableOperation): Promise<void> {
  const pool = sharedPool()
  await pool.query(`CREATE OR REPLACE FUNCTION atlas_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected % failure', TG_ARGV[0]; END $$`)
  await pool.query(`CREATE TRIGGER injected_${operation} BEFORE ${TRIGGER_EVENT[operation]} ON "SshSigningKey"
    FOR EACH ROW EXECUTE FUNCTION atlas_injected_failure('${operation}')`)
}

export function raceNextCreate(): void {
  let raced = false
  github.override(async (call) => {
    if (call.method !== 'POST' || raced) return undefined
    raced = true
    await db.orm.public.SshSigningKey.create({
      userId: USER,
      publicKey: 'rival',
      sealedPrivateKey: cipher.encrypt('rival'),
      githubKeyId: 999n,
      userName: 'rival',
      userEmail: 'rival@users.noreply.github.com',
    })
    return undefined
  })
}

export async function resetWorld(): Promise<SshSigningKeyService> {
  github.reset()
  const pool = sharedPool()
  for (const operation of Object.keys(TRIGGER_EVENT)) {
    await pool.query(`DROP TRIGGER IF EXISTS injected_${operation} ON "SshSigningKey"`)
  }
  await seedUser({ db, id: USER })
  await connect({ scopes: SIGNING_SCOPES })
  return new SshSigningKeyService(
    cipher,
    new GithubService(cipher, new EnvService({}), new GithubDeviceClient({})),
    new GithubSigningKeysClient({ fetchFn: github.fetchFn }),
  )
}

export const deletedIds = (): string[] =>
  github.calls.filter((call) => call.method === 'DELETE').map((call) => call.url.split('/').pop() ?? '')
