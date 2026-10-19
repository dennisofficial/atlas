import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { cloudRequest } from '@dltech/atlas-harness'
import { sshSigningKeyLeaseSchema, type SshSigningKeyLease } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLog } from './serve-log'

const SIGNING_KEY_FILE = 'ssh-signing-key'
const ALLOWED_SIGNERS_FILE = 'ssh-allowed-signers'

export const fetchSigningKeyLease = async (args: {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}): Promise<SshSigningKeyLease | undefined> => {
  try {
    const body = await cloudRequest({
      url: args.controlPlaneUrl.replace(/\/+$/, ''),
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
      method: 'GET',
      path: '/v1/ssh-signing-key',
      allowMissing: true,
    })
    const parsed = sshSigningKeyLeaseSchema.safeParse(body)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

const withTrailingNewline = (pem: string): string => (pem.endsWith('\n') ? pem : `${pem}\n`)

export const applySigningKeyEnv = async (args: {
  env: Record<string, string | undefined>
  atlasHome: string
  lease: SshSigningKeyLease
}): Promise<void> => {
  const { env, atlasHome, lease } = args
  const keyPath = join(atlasHome, SIGNING_KEY_FILE)
  const allowedSignersPath = join(atlasHome, ALLOWED_SIGNERS_FILE)

  await mkdir(atlasHome, { recursive: true })
  await writeFile(keyPath, withTrailingNewline(lease.privateKey), { mode: 0o600 })
  await chmod(keyPath, 0o600)
  await writeFile(allowedSignersPath, `${lease.userEmail} ${lease.publicKey}\n`, { mode: 0o644 })

  const entries: Array<readonly [key: string, value: string]> = [
    ['gpg.format', 'ssh'],
    ['user.signingkey', keyPath],
    ['commit.gpgsign', 'true'],
    ['tag.gpgsign', 'true'],
    ['user.name', lease.userName],
    ['user.email', lease.userEmail],
    ['gpg.ssh.allowedSignersFile', allowedSignersPath],
  ]
  const offset = Number(env.GIT_CONFIG_COUNT ?? 0)
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${offset + index}`] = key
    env[`GIT_CONFIG_VALUE_${offset + index}`] = value
  })
  env.GIT_CONFIG_COUNT = String(offset + entries.length)
}

export const applySigningKey = async (args: {
  env: Record<string, string | undefined>
  atlasHome: string
  log: ServeLog
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}): Promise<void> => {
  const lease = await fetchSigningKeyLease(args)
  if (lease === undefined) {
    args.log({ event: EServeEvent.SigningKeyAbsent })
    return
  }
  try {
    await applySigningKeyEnv({ env: args.env, atlasHome: args.atlasHome, lease })
  } catch (failure) {
    args.log({
      event: EServeEvent.SigningKeyWriteFailed,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
    return
  }
  args.log({ event: EServeEvent.SigningKeyReady, userEmail: lease.userEmail })
}
