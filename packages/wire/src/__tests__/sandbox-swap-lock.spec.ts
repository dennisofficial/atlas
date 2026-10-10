import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import {
  SWAP_LOCK_TIMEOUT_SECONDS,
  acquireSwapLock,
  withSwapLock,
  type SandboxSh,
} from '../sandbox-swap-lock.js'
import { SWAP_LOCK_PATH } from '../serve-env.js'

const fakeSandbox = () => ({ name: 'atlas-thread-x' }) as unknown as Sandbox

const finished = (exitCode: number, stderr = ''): Awaited<ReturnType<SandboxSh>> =>
  ({
    exitCode,
    stdout: async () => '',
    stderr: async () => stderr,
  }) as Awaited<ReturnType<SandboxSh>>

const shReturning = (exitCode: number, scripts: string[] = []): SandboxSh =>
  (async ({ script }: { script: string }) => {
    scripts.push(script)
    return finished(exitCode)
  }) as SandboxSh

describe('acquireSwapLock', () => {
  it('takes a blocking flock with a bounded wait on the dedicated lock path', async () => {
    const scripts: string[] = []

    const lease = await acquireSwapLock({ sandbox: fakeSandbox(), sh: shReturning(0, scripts) })
    await lease.release()

    const acquire = scripts[0] ?? ''
    expect(acquire).toContain(`flock -w ${SWAP_LOCK_TIMEOUT_SECONDS}`)
    expect(acquire).toContain(SWAP_LOCK_PATH)
    expect(acquire).not.toContain('flock -n')
    expect(scripts[1] ?? '').toContain('flock -u')
  })

  it('fails classified and untouched when the lock stays busy past the wait bound', async () => {
    await expect(
      acquireSwapLock({ sandbox: fakeSandbox(), sh: shReturning(1) }),
    ).rejects.toThrow(/swap lock stayed busy .* another wake is mid-swap .* preserved untouched/)
  })

  it('surfaces a broken lock path instead of reading it as contention', async () => {
    const broken: SandboxSh = (async () => finished(127, 'sh: flock: not found')) as SandboxSh

    await expect(acquireSwapLock({ sandbox: fakeSandbox(), sh: broken })).rejects.toThrow(
      'flock: not found',
    )
    await expect(acquireSwapLock({ sandbox: fakeSandbox(), sh: broken })).rejects.not.toThrow(
      'another wake is mid-swap',
    )
  })

  it('releases at most once even when the caller releases twice', async () => {
    const scripts: string[] = []

    const lease = await acquireSwapLock({ sandbox: fakeSandbox(), sh: shReturning(0, scripts) })
    await lease.release()
    await lease.release()

    expect(scripts.filter((script) => script.includes('flock -u'))).toHaveLength(1)
  })

  it('swallows a release failure — the sandbox kernel drops the flock when the holder dies', async () => {
    const flaky: SandboxSh = (async ({ script }: { script: string }) => {
      if (script.includes('flock -u')) throw new Error('the sandbox went away')
      return finished(0)
    }) as SandboxSh

    const lease = await acquireSwapLock({ sandbox: fakeSandbox(), sh: flaky })
    await lease.release()
  })
})

describe('withSwapLock', () => {
  it('releases the lock when the guarded work throws', async () => {
    const scripts: string[] = []

    await expect(
      withSwapLock({
        sandbox: fakeSandbox(),
        sh: shReturning(0, scripts),
        run: async () => {
          throw new Error('install blew up')
        },
      }),
    ).rejects.toThrow('install blew up')

    expect(scripts.some((script) => script.includes('flock -u'))).toBe(true)
  })
})
