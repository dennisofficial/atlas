import { createHash, randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { CredentialError, ECredentialFailure } from './credential-error'

const OWNER_ONLY = 0o600
const ACCOUNT_LOCK_TIMEOUT_MS = 30_000
const VAULT_LOCK_TIMEOUT_MS = 10_000
const POLL_MS = 25

export interface VaultLocks {
  account<T>(args: { accountId: string; run: () => Promise<T> }): Promise<T>
  vault<T>(run: () => Promise<T>): Promise<T>
}

type Release = () => void

const tails = new Map<string, Promise<unknown>>()
const activeReleases = new Set<Release>()
process.once('exit', () => {
  for (const release of activeReleases) {
    try { release() } catch {}
  }
})

const queued = <T>(args: { key: string; task: () => Promise<T> }): Promise<T> => {
  const result = (tails.get(args.key) ?? Promise.resolve()).then(args.task)
  const tail = result.catch(() => undefined)
  tails.set(args.key, tail)
  void tail.then(() => {
    if (tails.get(args.key) === tail) tails.delete(args.key)
  })

  return result
}

const exclusive = <T>(args: {
  key: string
  enter: () => Promise<Release>
  run: () => Promise<T>
}): Promise<T> =>
  queued({
    key: args.key,
    task: async () => {
      const release = await args.enter()
      try {
        return await args.run()
      } finally {
        release()
      }
    },
  })

export const inProcessVaultLocks = (): VaultLocks => {
  const scope = `memory:${randomUUID()}`
  const nothingToRelease = async (): Promise<Release> => () => undefined

  return {
    account: (args) =>
      exclusive({ key: `${scope}:${args.accountId}`, enter: nothingToRelease, run: args.run }),
    vault: (run) => exclusive({ key: `${scope}:vault`, enter: nothingToRelease, run }),
  }
}

const errorCode = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined

const ownerPidOf = (content: string): number | undefined => {
  const pid = Number.parseInt(content.split(':')[0] ?? '', 10)
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

const processIsGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return errorCode(error) === 'ESRCH'
  }
}

const readOwner = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

const refusal = (message: string): CredentialError =>
  new CredentialError({ failure: ECredentialFailure.StoreUnavailable, message })

const stillHeld = (path: string): CredentialError =>
  refusal(
    `Another Atlas process is holding the account lock at ${path}. Wait for it to finish, then retry.`,
  )

const leftBehind = (path: string): CredentialError =>
  refusal(
    `The account lock at ${path} was left by an Atlas process that is no longer running. Atlas will not break it automatically, because a refresh token may have been in flight. Confirm no Atlas is running, remove that file, then retry.`,
  )

const acquireFile = async (args: {
  path: string
  timeoutMs: number
  pollMs: number
  sleep: (ms: number) => Promise<void>
}): Promise<Release> => {
  mkdirSync(dirname(args.path), { recursive: true })
  const content = `${process.pid}:${randomUUID()}`
  const deadline = Date.now() + args.timeoutMs

  for (;;) {
    try {
      const descriptor = openSync(args.path, 'wx', OWNER_ONLY)
      writeSync(descriptor, content)
      closeSync(descriptor)

      const release = () => {
        if (readOwner(args.path) === content) rmSync(args.path, { force: true })
        activeReleases.delete(release)
      }
      activeReleases.add(release)
      return release
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }

    const owner = readOwner(args.path)
    const pid = owner === undefined ? undefined : ownerPidOf(owner)
    if (pid !== undefined && processIsGone(pid)) throw leftBehind(args.path)
    if (Date.now() >= deadline) throw stillHeld(args.path)

    await args.sleep(args.pollMs)
  }
}

export const fileVaultLocks = (
  file: string,
  options?: {
    accountTimeoutMs?: number
    vaultTimeoutMs?: number
    pollMs?: number
    sleep?: (ms: number) => Promise<void>
  },
): VaultLocks => {
  const directory = resolve(`${file}.locks`)
  const pollMs = options?.pollMs ?? POLL_MS
  const sleep = options?.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))

  const locked = <T>(args: { path: string; timeoutMs: number; run: () => Promise<T> }): Promise<T> =>
    exclusive({
      key: args.path,
      enter: () => acquireFile({ path: args.path, timeoutMs: args.timeoutMs, pollMs, sleep }),
      run: args.run,
    })

  return {
    account: (args) =>
      locked({
        path: join(
          directory,
          `account-${createHash('sha256').update(args.accountId).digest('hex').slice(0, 24)}.lock`,
        ),
        timeoutMs: options?.accountTimeoutMs ?? ACCOUNT_LOCK_TIMEOUT_MS,
        run: args.run,
      }),
    vault: (run) =>
      locked({
        path: join(directory, 'vault.lock'),
        timeoutMs: options?.vaultTimeoutMs ?? VAULT_LOCK_TIMEOUT_MS,
        run,
      }),
  }
}
