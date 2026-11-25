import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { WORKLOAD_CGROUP_ENV } from '@dltech/atlas-sandbox'

import { ManagedProcess } from '../process/managed'

const NOOP = (): void => {}

const tempRoot = (): string => mkdtempSync(join(tmpdir(), 'atlas-process-exit-'))

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitUntil = async (args: { check: () => boolean; timeoutMs?: number }): Promise<void> => {
  const deadline = Date.now() + (args.timeoutMs ?? 5_000)
  while (Date.now() < deadline) {
    if (args.check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('timed out waiting')
}

const spawnInBox = (args: { script: string; workGroup: string }): ManagedProcess =>
  ManagedProcess.spawn({
    cmd: ['/bin/sh', '-c', args.script],
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', [WORKLOAD_CGROUP_ENV]: args.workGroup },
    onStdout: NOOP,
    onStderr: NOOP,
  })

const makeBox = (args: { workGroup: string; pid: number }): string => {
  const box = join(args.workGroup, `w-${args.pid}`)
  mkdirSync(box, { recursive: true })
  return box
}

describe('a managed process and its workload box', () => {
  it('leaves the box alone when the process exits on its own', async () => {
    const root = tempRoot()
    try {
      const workGroup = join(root, 'atlas-work')
      mkdirSync(workGroup, { recursive: true })
      const child = spawnInBox({ script: 'sleep 0.3', workGroup })
      const box = makeBox({ workGroup, pid: child.pid })

      const exit = await child.exit()

      expect(exit.exitCode).toBe(0)
      expect(existsSync(join(box, 'cgroup.kill'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('kills the box when the process is cancelled, timed out or stopped', async () => {
    const root = tempRoot()
    try {
      const workGroup = join(root, 'atlas-work')
      mkdirSync(workGroup, { recursive: true })
      const child = spawnInBox({ script: 'sleep 30', workGroup })
      const box = makeBox({ workGroup, pid: child.pid })

      child.kill()
      await child.exit()

      expect(readFileSync(join(box, 'cgroup.kill'), 'utf8')).toBe('1')
      await waitUntil({ check: () => !isAlive(child.pid) })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('lets a process that leaves the group with setsid outlive the call', async () => {
    const root = tempRoot()
    try {
      const workGroup = join(root, 'atlas-work')
      const pidFile = join(root, 'detached.pid')
      mkdirSync(workGroup, { recursive: true })
      const child = spawnInBox({
        script: `setsid sh -c "echo \\$\\$ > ${pidFile}; exec sleep 30" >/dev/null 2>&1 & while [ ! -s ${pidFile} ]; do :; done`,
        workGroup,
      })
      makeBox({ workGroup, pid: child.pid })

      await child.exit()
      const pid = Number(readFileSync(pidFile, 'utf8').trim())

      expect(isAlive(pid)).toBe(true)
      process.kill(-pid, 'SIGKILL')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('kills a plain background child with the call', async () => {
    const root = tempRoot()
    try {
      const workGroup = join(root, 'atlas-work')
      const pidFile = join(root, 'grouped.pid')
      mkdirSync(workGroup, { recursive: true })
      const child = spawnInBox({
        script: `sleep 30 & echo $! > ${pidFile}; while [ ! -s ${pidFile} ]; do :; done`,
        workGroup,
      })
      makeBox({ workGroup, pid: child.pid })

      await child.exit()
      const pid = Number(readFileSync(pidFile, 'utf8').trim())

      await waitUntil({ check: () => !isAlive(pid) })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)
})
