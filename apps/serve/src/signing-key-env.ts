import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
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

export enum ESigningKeyEnvResult {
  Applied = 'applied',
  EnvInvalid = 'env-invalid',
}

const writeAtomically = async (args: {
  dir: string
  fileName: string
  content: string
  mode: number
}): Promise<void> => {
  const tempPath = join(args.dir, `.${args.fileName}.${randomBytes(8).toString('hex')}`)
  const handle = await open(tempPath, 'wx', args.mode)
  try {
    try {
      await handle.writeFile(args.content)
      await handle.chmod(args.mode)
      await handle.datasync()
    } finally {
      await handle.close()
    }
    await rename(tempPath, join(args.dir, args.fileName))
  } catch (failure) {
    await unlink(tempPath).catch(() => undefined)
    throw failure
  }
}

const readGitConfigCount = (env: Record<string, string | undefined>): number | undefined => {
  const raw = env.GIT_CONFIG_COUNT
  if (raw === undefined) return 0
  if (!/^\d+$/.test(raw)) return undefined
  const count = Number(raw)
  if (!Number.isSafeInteger(count)) return undefined
  for (let index = 0; index < count; index += 1) {
    if (env[`GIT_CONFIG_KEY_${index}`] === undefined) return undefined
    if (env[`GIT_CONFIG_VALUE_${index}`] === undefined) return undefined
  }
  return count
}

export const applySigningKeyEnv = async (args: {
  env: Record<string, string | undefined>
  atlasHome: string
  lease: SshSigningKeyLease
}): Promise<ESigningKeyEnvResult> => {
  const { env, atlasHome, lease } = args
  const offset = readGitConfigCount(env)
  if (offset === undefined) return ESigningKeyEnvResult.EnvInvalid

  const keyPath = join(atlasHome, SIGNING_KEY_FILE)
  const allowedSignersPath = join(atlasHome, ALLOWED_SIGNERS_FILE)

  await mkdir(atlasHome, { recursive: true })
  await writeAtomically({
    dir: atlasHome,
    fileName: SIGNING_KEY_FILE,
    content: withTrailingNewline(lease.privateKey),
    mode: 0o600,
  })
  await writeAtomically({
    dir: atlasHome,
    fileName: ALLOWED_SIGNERS_FILE,
    content: `${lease.userEmail} ${lease.publicKey}\n`,
    mode: 0o644,
  })

  const entries: Array<readonly [key: string, value: string]> = [
    ['gpg.format', 'ssh'],
    ['user.signingkey', keyPath],
    ['commit.gpgsign', 'true'],
    ['tag.gpgsign', 'true'],
    ['user.name', lease.userName],
    ['user.email', lease.userEmail],
    ['gpg.ssh.allowedSignersFile', allowedSignersPath],
  ]
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${offset + index}`] = key
    env[`GIT_CONFIG_VALUE_${offset + index}`] = value
  })
  env.GIT_CONFIG_COUNT = String(offset + entries.length)
  return ESigningKeyEnvResult.Applied
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
  let result: ESigningKeyEnvResult
  try {
    result = await applySigningKeyEnv({ env: args.env, atlasHome: args.atlasHome, lease })
  } catch (failure) {
    args.log({
      event: EServeEvent.SigningKeyWriteFailed,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
    return
  }
  if (result === ESigningKeyEnvResult.EnvInvalid) {
    args.log({ event: EServeEvent.SigningKeyEnvInvalid })
    return
  }
  args.log({ event: EServeEvent.SigningKeyReady, userEmail: lease.userEmail })
}
