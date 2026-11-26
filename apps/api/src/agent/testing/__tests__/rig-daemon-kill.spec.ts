import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { killProcessesUnder } from '../rig-daemon'

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitUntilDead = async (pid: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

const sleeperOf = (cwd: string): Bun.Subprocess<'ignore', 'ignore', 'ignore'> =>
  Bun.spawn({
    cmd: ['sleep', '60'],
    cwd,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })

describe('killProcessesUnder', () => {
  it.skipIf(process.platform !== 'linux')(
    'kills a process working inside the root and leaves one working outside it',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'atlas-kill-under-'))
      const workspace = join(root, 'workspace')
      mkdirSync(workspace, { recursive: true })
      const inside = sleeperOf(workspace)
      const outside = sleeperOf(tmpdir())
      try {
        expect(alive(inside.pid)).toBe(true)
        killProcessesUnder(workspace)
        expect(await waitUntilDead(inside.pid)).toBe(true)
        expect(alive(outside.pid)).toBe(true)
      } finally {
        inside.kill('SIGKILL')
        outside.kill('SIGKILL')
        await inside.exited.catch(() => undefined)
        await outside.exited.catch(() => undefined)
        rmSync(root, { recursive: true, force: true })
      }
    },
    20_000,
  )
})
