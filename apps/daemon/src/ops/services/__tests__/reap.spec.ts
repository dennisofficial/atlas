import { describe, expect, it } from 'bun:test'

import { EServiceReapOutcome } from '@dltech/atlas-protocol'

import { reapService } from '../reap'

const spawnDetached = (command: string) =>
  Bun.spawn({ cmd: ['/bin/sh', '-c', command], stdout: 'ignore', stderr: 'ignore', detached: true })

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('reaping the process an earlier daemon left behind', () => {
  it('kills the group of a process whose command line matches', async () => {
    const child = spawnDetached('sleep 30')
    try {
      expect(alive(child.pid)).toBe(true)
      const outcome = await reapService({
        pid: child.pid,
        command: 'sleep 30',
        owned: false,
      })
      expect(outcome).toBe(EServiceReapOutcome.Reaped)
      expect(alive(child.pid)).toBe(false)
    } finally {
      child.kill('SIGKILL')
    }
  }, 15_000)

  it('leaves a pid another command holds alone', async () => {
    const child = spawnDetached('sleep 30')
    try {
      const outcome = await reapService({
        pid: child.pid,
        command: 'bun run dev',
        owned: false,
      })
      expect(outcome).toBe(EServiceReapOutcome.Mismatch)
      expect(alive(child.pid)).toBe(true)
    } finally {
      child.kill('SIGKILL')
    }
  }, 15_000)

  it('leaves a pid the daemon still runs alone', async () => {
    const child = spawnDetached('sleep 30')
    try {
      const outcome = await reapService({ pid: child.pid, command: 'sleep 30', owned: true })
      expect(outcome).toBe(EServiceReapOutcome.Mismatch)
      expect(alive(child.pid)).toBe(true)
    } finally {
      child.kill('SIGKILL')
    }
  }, 15_000)

  it('reports a pid that is already gone', async () => {
    const child = spawnDetached('true')
    await child.exited
    expect(await reapService({ pid: child.pid, command: 'true', owned: false })).toBe(
      EServiceReapOutcome.Absent,
    )
  }, 15_000)
})
