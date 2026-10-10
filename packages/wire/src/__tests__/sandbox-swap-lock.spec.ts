import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import {
  SWAP_LOCK_TIMEOUT_SECONDS,
  acquireSwapLock,
  sandboxSh,
  withSwapLock,
  type SandboxSh,
} from '../sandbox-swap-lock.js'
import { SWAP_LOCK_PATH } from '../serve-env.js'

const finished = (exitCode: number, stdout = ''): Awaited<ReturnType<SandboxSh>> =>
  ({
    exitCode,
    stdout: async () => stdout,
    stderr: async () => '',
  }) as Awaited<ReturnType<SandboxSh>>

/**
 * A fake that emulates flock's observable contract: one detached holder owns the lock at a time,
 * a contender's holder blocks until the current holder is killed, and a HELD probe sees the held
 * marker only while its holder owns the lock. Mutual exclusion itself is proven by the live
 * two-process flock test (a contender times out while a holder lives, then acquires on its exit);
 * this fake exists so the acquire/release lifecycle and cleanup are exercisable under `bun test`.
 */
const flockSandbox = () => {
  const scripts: string[] = []
  const killed = new Set<string>()
  let owner: string | undefined

  const sandbox = {
    name: 'atlas-thread-x',
    runCommand: async (params: {
      cmd: string
      args?: string[]
      detached?: boolean
      timeoutMs?: number
    }) => {
      const script = params.args?.[1] ?? params.cmd
      scripts.push(script)
      if (params.detached === true) {
        const held = script.match(/: > (\S+\.held\.[\d.]+)/)?.[1] ?? ''
        const release = script.match(/\[ ! -f (\S+\.release\.[\d.]+) \]/)?.[1] ?? ''
        const holder = (async () => {
          // Block until no other holder owns the lock.
          while (owner !== undefined) await new Promise((r) => setTimeout(r, 5))
          owner = held
          // Stay alive until released or killed, then free the lock.
          while (!killed.has(held) && !releasedSet.has(release))
            await new Promise((r) => setTimeout(r, 5))
          if (owner === held) owner = undefined
          return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
        })()
        return {
          cmdId: `cmd_${held}`,
          exitCode: null,
          wait: async () => holder,
          kill: async () => {
            killed.add(held)
            await holder.catch(() => undefined)
          },
        }
      }
      const heldProbe = script.match(/\[ -f (\S+\.held\.[\d.]+) \]/)?.[1]
      if (heldProbe !== undefined) {
        return finished(0, owner === heldProbe && !killed.has(heldProbe) ? 'HELD' : 'WAIT')
      }
      if (script.startsWith('touch ') && script.includes('.release.')) {
        releasedSet.add(script.replace('touch ', '').trim())
        return finished(0)
      }
      if (script.startsWith('rm -f')) return finished(0)
      return finished(0)
    },
  }
  const releasedSet = new Set<string>()
  return { sandbox: sandbox as unknown as Sandbox, scripts }
}

describe('acquireSwapLock', () => {
  it('runs the holder detached, holding a blocking flock with a bounded wait on the lock path', async () => {
    const { sandbox, scripts } = flockSandbox()

    const lease = await acquireSwapLock({ sandbox, sh: sandboxSh })
    await lease.release()

    const holderScript = scripts.find((script) => script.includes('exec 9>'))
    expect(holderScript).toBeDefined()
    expect(holderScript).toContain(`flock -w ${SWAP_LOCK_TIMEOUT_SECONDS}`)
    expect(holderScript).toContain(SWAP_LOCK_PATH)
    expect(holderScript).not.toContain('flock -n')
    expect(holderScript).toContain('while [ ! -f')
  })

  it('releases via the release marker and a kill backstop, then cleans up its markers', async () => {
    const { sandbox, scripts } = flockSandbox()

    const lease = await acquireSwapLock({ sandbox, sh: sandboxSh })
    await lease.release()

    expect(scripts.some((script) => script.includes('touch ') && script.includes('.release.'))).toBe(true)
    expect(scripts.some((script) => script.startsWith('rm -f') && script.includes('.held.'))).toBe(true)
  })
})

describe('withSwapLock', () => {
  it('releases the lock when the guarded work throws, so a later acquirer proceeds', async () => {
    const { sandbox } = flockSandbox()

    await expect(
      withSwapLock({
        sandbox,
        sh: sandboxSh,
        run: async () => {
          throw new Error('install blew up')
        },
      }),
    ).rejects.toThrow('install blew up')

    const order: string[] = []
    await withSwapLock({
      sandbox,
      sh: sandboxSh,
      run: async () => {
        order.push('second-run')
      },
    })
    expect(order).toEqual(['second-run'])
  })
})
