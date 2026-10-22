import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CredentialError, ECredentialFailure } from '../credential-error'
import { fileVaultLocks, inProcessVaultLocks } from '../vault-lock'

const NO_WAIT = async (): Promise<void> => undefined
const DEAD_PID = 2_147_483_646

let directory: string
let file: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-vault-lock-'))
  file = join(directory, 'auth.json')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const lockFileFor = (locks: ReturnType<typeof fileVaultLocks>): Promise<string> =>
  new Promise((found) => {
    void locks.vault(async () => found(join(`${file}.locks`, 'vault.lock')))
  })

describe('the vault locks', () => {
  it('run one holder at a time across instances sharing a file', async () => {
    const shared = { running: 0, peak: 0 }
    const hold = (locks: ReturnType<typeof fileVaultLocks>) =>
      locks.account({
        accountId: 'acc_1',
        run: async () => {
          shared.running += 1
          shared.peak = Math.max(shared.peak, shared.running)
          await new Promise((done) => setTimeout(done, 5))
          shared.running -= 1
        },
      })

    await Promise.all([hold(fileVaultLocks(file)), hold(fileVaultLocks(file)), hold(fileVaultLocks(file))])

    expect(shared.peak).toBe(1)
  })

  it('release after the callback throws', async () => {
    const locks = fileVaultLocks(file)

    await expect(locks.account({ accountId: 'acc_1', run: async () => Promise.reject(new Error('boom')) })).rejects.toThrow('boom')

    expect(await locks.account({ accountId: 'acc_1', run: async () => 'again' })).toBe('again')
  })

  it('keeps accounts independent of one another', async () => {
    const locks = fileVaultLocks(file)

    const inner = await locks.account({
      accountId: 'acc_1',
      run: () => locks.account({ accountId: 'acc_2', run: async () => 'ok' }),
    })

    expect(inner).toBe('ok')
  })

  it('refuses a lock whose owner process is gone instead of taking it over', async () => {
    const locks = fileVaultLocks(file, { pollMs: 1, sleep: NO_WAIT })
    const path = await lockFileFor(locks)
    mkdirSync(`${file}.locks`, { recursive: true })
    writeFileSync(path, `${DEAD_PID}:left-behind`)
    let ran = false

    const refused = await locks
      .vault(async () => {
        ran = true
      })
      .catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(CredentialError)
    expect((refused as CredentialError).failure).toBe(ECredentialFailure.StoreUnavailable)
    expect((refused as CredentialError).message).toContain('will not break it automatically')
    expect(ran).toBe(false)
  })

  it('refuses after the bounded wait on a live holder without expiring its lease', async () => {
    const locks = fileVaultLocks(file, { vaultTimeoutMs: 20, pollMs: 1 })
    const path = await lockFileFor(locks)
    mkdirSync(`${file}.locks`, { recursive: true })
    writeFileSync(path, `${process.pid}:other-instance`)

    const refused = await locks.vault(async () => 'ran').catch((error: unknown) => error)

    expect((refused as CredentialError).message).toContain('holding the account lock')
  })
})

describe('the in-process locks', () => {
  it('serialise callers of one instance and do not alias another instance', async () => {
    const first = inProcessVaultLocks()
    const second = inProcessVaultLocks()
    const order: string[] = []

    await Promise.all([
      first.vault(async () => {
        order.push('a-start')
        await new Promise((done) => setTimeout(done, 5))
        order.push('a-end')
      }),
      first.vault(async () => {
        order.push('b')
      }),
      second.vault(async () => {
        order.push('other')
      }),
    ])

    expect(order.indexOf('a-end')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('other')).toBeLessThan(order.indexOf('a-end'))
  })
})
