import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { EExecOutcome, EShellRunStatus } from '@dltech/atlas-protocol'

import {
  execResult,
  execValue,
  gatedCommand,
  scratch,
  shellEnd,
  shellOutput,
  startExec,
} from './exec-background-rig'
import { oomTarget, openSession } from './oom-rig'

const DEADLINE_MS = 600

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe('an exec whose foreground deadline the daemon owns', () => {
  it('moves the exec to its background shell at the deadline instead of killing it', async () => {
    const handle = await oomTarget.start()
    const dir = scratch()
    const gate = join(dir, 'gate')
    try {
      const session = await openSession(handle)
      const startedAt = performance.now()
      await startExec({
        session,
        key: 'exec-deadline',
        command: gatedCommand({ gate, first: 'before', then: 'after', exitCode: 7 }),
        deadlineMs: DEADLINE_MS,
        shellId: 'deadline-shell',
      })
      const exec = await execResult({ session, key: 'exec-deadline' })
      const elapsed = performance.now() - startedAt

      expect(exec.outcome).toBe(EExecOutcome.Backgrounded)
      expect(exec.shellId).toBe('deadline-shell')
      expect(exec.exitCode).toBeNull()
      expect(elapsed).toBeGreaterThanOrEqual(DEADLINE_MS)

      writeFileSync(gate, '')
      const ended = await shellEnd({ session, shellId: 'deadline-shell' })
      expect(ended.status).toBe(EShellRunStatus.Exited)
      expect(ended.exitCode).toBe(7)

      const output = await shellOutput({ session, key: 'read', shellId: 'deadline-shell' })
      expect(output).toContain('after')
    } finally {
      await handle.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('answers a host that re-attaches after the deadline with the handover, not a fresh window', async () => {
    const handle = await oomTarget.start()
    const dir = scratch()
    const gate = join(dir, 'gate')
    const command = gatedCommand({ gate, first: 'before', then: 'after', exitCode: 0 })
    try {
      const first = await openSession(handle)
      await startExec({
        session: first,
        key: 'exec-reattach',
        command,
        deadlineMs: DEADLINE_MS,
        shellId: 'reattach-shell',
      })
      first.close()
      await sleep(2 * DEADLINE_MS)

      const second = await openSession(handle)
      const startedAt = performance.now()
      second.send({
        kind: 'run',
        key: 'exec-reattach',
        epoch: 1,
        op: {
          op: 'exec',
          argv: ['/bin/sh', '-c', command],
          deadlineMs: DEADLINE_MS,
          shellId: 'reattach-shell',
        },
      })
      const frame = await second.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'exec-reattach',
      )
      const elapsed = performance.now() - startedAt
      const exec = execValue(frame)

      expect(exec.outcome).toBe(EExecOutcome.Backgrounded)
      expect(exec.shellId).toBe('reattach-shell')
      expect(elapsed).toBeLessThan(DEADLINE_MS)

      writeFileSync(gate, '')
      const ended = await shellEnd({ session: second, shellId: 'reattach-shell' })
      expect(ended.status).toBe(EShellRunStatus.Exited)
    } finally {
      await handle.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('reports the command that exits before the deadline as an ordinary exit', async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      await startExec({
        session,
        key: 'exec-quick',
        command: 'echo quick; exit 4',
        deadlineMs: 20_000,
        shellId: 'unused-shell',
      })
      const exec = await execResult({ session, key: 'exec-quick' })

      expect(exec.outcome).toBe(EExecOutcome.Exited)
      expect(exec.exitCode).toBe(4)
      expect(exec.shellId).toBeUndefined()
    } finally {
      await handle.stop()
    }
  }, 30_000)
})
