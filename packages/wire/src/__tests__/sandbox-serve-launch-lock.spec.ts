import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import { createServeLauncher } from '../sandbox-serve-launch.js'
import { SWAP_LOCK_PATH } from '../serve-env.js'

const lockAcquireOf = (script: string): boolean =>
  script.includes(`flock -w`) && script.includes(SWAP_LOCK_PATH)

const lockReleaseOf = (script: string): boolean =>
  (script.startsWith('touch ') && script.includes('.release.')) || script.includes('.release.')

const holderProbeOf = (script: string): boolean =>
  script.includes('.held.') || script.includes('.fail.') || script.includes('.release.')

const unlockedMutationOf = (commands: { args?: string[] }[]): string[] => {
  let locked = false
  const leaked: string[] = []
  for (const command of commands) {
    const script = command.args?.[1] ?? ''
    if (lockAcquireOf(script)) {
      locked = true
      continue
    }
    if (locked && lockReleaseOf(script)) {
      locked = false
      continue
    }
    if (locked || holderProbeOf(script)) continue
    leaked.push(script)
  }
  return leaked
}

const mutationProbeOf = (script: string): boolean => {
  if (script.startsWith('printf') || script.startsWith('test -x')) return true
  if (script.startsWith('kill "$_pid"') || script.includes('kill "$_pid"')) return true
  if (script.includes('atlas-serve-linux-x64')) return true
  return script.startsWith('for i in')
}

describe('the swap lock', () => {
  it('is a dedicated path in the sandbox, distinct from the boot flock', async () => {
    const { SERVE_LOCK_PATH, SERVE_HOME } = await import('../serve-env.js')
    expect(SWAP_LOCK_PATH).toBe(`${SERVE_HOME}/swap.lock`)
    expect(SWAP_LOCK_PATH).not.toBe(SERVE_LOCK_PATH)
  })

  it('runs every probe, install, stop, and health-wait between flock acquire and release', async () => {
    const commands: { args?: string[]; detached?: boolean }[] = []
    const sandbox = {
      name: 'atlas-thread-x',
      runCommand: async (params: { args?: string[]; detached?: boolean }) => {
        commands.push(params)
        const script = params.args?.[1] ?? ''
        if (params.detached === true && script.includes(SWAP_LOCK_PATH)) {
          // The swap-lock holder: a live process the driver kills on release.
          return {
            cmdId: 'cmd_lock',
            exitCode: null,
            wait: async () => ({ exitCode: 0, stdout: async () => '', stderr: async () => '' }),
            kill: async () => undefined,
          }
        }
        if (script.includes(SWAP_LOCK_PATH) && script.includes('.held.')) {
          // The acquire-status probe: this fake grants the lock immediately.
          return { exitCode: 0, stdout: async () => 'HELD', stderr: async () => '' }
        }
        if (script.includes(SWAP_LOCK_PATH)) {
          return { exitCode: 0, stdout: async () => '', stderr: async () => '' }
        }
        return { exitCode: 0, stdout: async () => '1.0.0\n' }
      },
      writeFiles: async () => undefined,
    }

    await createServeLauncher()({ sandbox: sandbox as unknown as Sandbox, token: 'tok_a' })

    const scripts = commands.map((command) => command.args?.[1] ?? '')
    expect(scripts.some(lockAcquireOf)).toBe(true)
    expect(scripts.some(lockReleaseOf)).toBe(true)
    const leaked = unlockedMutationOf(commands).filter(mutationProbeOf)
    expect(leaked).toEqual([])
  })
})
