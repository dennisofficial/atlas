import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { EExecOutcome, EShellRunStatus } from '@dltech/atlas-protocol'

import {
  killedInfo,
  gatedCommand,
  startExec,
  adopt,
  execResult,
  shellEnd,
  shellOutput,
  scratch,
} from './exec-background-rig'
import { expectedMemory, oomTarget, openSession, writeOomEvents } from './oom-rig'

describe('an exec that a host moves to the background', () => {
  it('a running exec moved to the background ends its call as backgrounded and keeps running as a shell', async () => {
    const handle = await oomTarget.start()
    const dir = scratch()
    const gate = join(dir, 'gate')
    try {
      const session = await openSession(handle)
      await startExec({
        session,
        key: 'exec-adopt',
        command: gatedCommand({ gate, first: 'before', then: 'after', exitCode: 3 }),
      })
      const adopted = await adopt({
        session,
        key: 'bg',
        execKey: 'exec-adopt',
        shellId: 'adopted-shell',
      })
      expect(adopted.adopted).toBe(true)
      expect(adopted.info?.shellId).toBe('adopted-shell')
      expect(adopted.info?.command).toContain('before')

      const exec = await execResult({ session, key: 'exec-adopt' })
      expect(exec.outcome).toBe(EExecOutcome.Backgrounded)
      expect(exec.shellId).toBe('adopted-shell')
      expect(exec.exitCode).toBeNull()

      writeFileSync(gate, '')
      const ended = await shellEnd({ session, shellId: 'adopted-shell' })
      expect(ended.status).toBe(EShellRunStatus.Exited)
      expect(ended.exitCode).toBe(3)

      const output = await shellOutput({ session, key: 'read', shellId: 'adopted-shell' })
      expect(output).toContain('after')
      expect(output).not.toContain('before')
    } finally {
      await handle.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('cancelling the exec call after adoption does not kill the shell', async () => {
    const handle = await oomTarget.start()
    const dir = scratch()
    const gate = join(dir, 'gate')
    try {
      const session = await openSession(handle)
      await startExec({
        session,
        key: 'exec-cancelled',
        command: gatedCommand({ gate, first: 'before', then: 'later', exitCode: 5 }),
      })
      const adopted = await adopt({
        session,
        key: 'bg-cancel',
        execKey: 'exec-cancelled',
        shellId: 'cancel-shell',
      })
      expect(adopted.adopted).toBe(true)
      session.send({ kind: 'cancel', key: 'exec-cancelled', epoch: 1 })
      writeFileSync(gate, '')
      const ended = await shellEnd({ session, shellId: 'cancel-shell' })
      expect(ended.status).toBe(EShellRunStatus.Exited)
      expect(ended.exitCode).toBe(5)
      const output = await shellOutput({ session, key: 'read-cancel', shellId: 'cancel-shell' })
      expect(output).toContain('later')
    } finally {
      await handle.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('shells.kill stops an adopted exec', async () => {
    const handle = await oomTarget.start()
    const dir = scratch()
    const gate = join(dir, 'gate')
    try {
      const session = await openSession(handle)
      await startExec({
        session,
        key: 'exec-killed',
        command: gatedCommand({ gate, first: 'before', then: 'never', exitCode: 0 }),
      })
      const adopted = await adopt({
        session,
        key: 'bg-kill',
        execKey: 'exec-killed',
        shellId: 'killed-shell',
      })
      expect(adopted.adopted).toBe(true)
      session.send({
        kind: 'run',
        key: 'kill',
        epoch: 1,
        op: { op: 'shells.kill', shellId: 'killed-shell' },
      })
      const killed = await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'kill',
        { timeoutMs: 20_000 },
      )
      expect(killedInfo(killed).status).toBe(EShellRunStatus.Killed)
      const ended = await shellEnd({ session, shellId: 'killed-shell' })
      expect(ended.status).toBe(EShellRunStatus.Killed)
    } finally {
      await handle.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('adopting an exec that already exited answers not adopted', async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      session.send({
        kind: 'run',
        key: 'exec-done',
        epoch: 1,
        op: { op: 'exec', argv: ['/bin/sh', '-c', 'echo done'] },
      })
      const finished = await execResult({ session, key: 'exec-done' })
      expect(finished.outcome).toBe(EExecOutcome.Exited)
      const adopted = await adopt({
        session,
        key: 'bg-done',
        execKey: 'exec-done',
        shellId: 'late-shell',
      })
      expect(adopted.adopted).toBe(false)
      expect(adopted.info).toBeUndefined()
    } finally {
      await handle.stop()
    }
  }, 30_000)

  it('adopting an exec this daemon never saw answers not adopted', async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      const adopted = await adopt({
        session,
        key: 'bg-unknown',
        execKey: 'no-such-call',
        shellId: 'ghost-shell',
      })
      expect(adopted.adopted).toBe(false)
    } finally {
      await handle.stop()
    }
  }, 30_000)

  it('an adopted exec whose box was out of memory ends as out of memory', async () => {
    const handle = await oomTarget.start()
    const dir = scratch()
    const gate = join(dir, 'gate')
    try {
      const session = await openSession(handle)
      await startExec({
        session,
        key: 'exec-oom',
        command: `${writeOomEvents(6)}; echo before; while [ ! -f ${gate} ]; do sleep 0.05; done; exit 4`,
      })
      const adopted = await adopt({
        session,
        key: 'bg-oom',
        execKey: 'exec-oom',
        shellId: 'oom-adopted',
      })
      expect(adopted.adopted).toBe(true)
      writeFileSync(gate, '')
      const ended = await shellEnd({ session, shellId: 'oom-adopted' })
      expect(ended.status).toBe(EShellRunStatus.OomKilled)
      expect(ended.exitCode).toBe(4)
      expect(ended.memory).toEqual(expectedMemory())
    } finally {
      await handle.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
