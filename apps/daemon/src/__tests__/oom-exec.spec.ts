import { describe, expect, it } from 'bun:test'

import { EOomScope } from '@dltech/atlas-core'
import {
  EExecOutcome,
  type DaemonFrame,
  type ExecResult,
  type OomListResult,
} from '@dltech/atlas-protocol'

import { expectedMemory, oomTarget, openSession, writeOomEvents } from './oom-rig'

const execValue = (frame: DaemonFrame): ExecResult => {
  if (frame.kind !== 'result' || frame.result.status !== 'ok' || frame.result.op !== 'exec') {
    throw new Error(`unexpected ${JSON.stringify(frame)}`)
  }
  return frame.result.value
}

const oomListValue = (frame: DaemonFrame): OomListResult => {
  if (frame.kind !== 'result' || frame.result.status !== 'ok' || frame.result.op !== 'oom.list') {
    throw new Error(`unexpected ${JSON.stringify(frame)}`)
  }
  return frame.result.value
}

describe('an exec that the kernel kills for memory', () => {
  it('an exec that is OOM-killed as its timeout fires ends as out of memory', async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      session.send({
        kind: 'run',
        key: 'oom-timeout',
        epoch: 1,
        op: {
          op: 'exec',
          argv: ['/bin/sh', '-c', `${writeOomEvents(12)}; sleep 5`],
          timeoutMs: 300,
        },
      })
      const frame = await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'oom-timeout',
        { timeoutMs: 20_000 },
      )
      const value = execValue(frame)
      expect(value.outcome).toBe(EExecOutcome.OomKilled)
      expect(value.memory).toEqual(expectedMemory())

      session.send({ kind: 'run', key: 'oom-list', epoch: 1, op: { op: 'oom.list' } })
      const listed = await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'oom-list',
      )
      const incidents = oomListValue(listed).incidents
      expect(incidents).toHaveLength(1)
      expect(incidents[0]?.scope).toBe(EOomScope.Command)
      expect(incidents[0]?.processes).toBe(12)
      expect(incidents[0]?.command).toContain('oom_kill 12')
      expect(incidents[0]?.memory).toEqual(expectedMemory())
    } finally {
      await handle.stop()
    }
  }, 30_000)

  it('an exec cancelled while its box is out of memory ends as out of memory', async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      session.send({
        kind: 'run',
        key: 'oom-cancel',
        epoch: 1,
        op: { op: 'exec', argv: ['/bin/sh', '-c', `${writeOomEvents(3)}; sleep 5`] },
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
      session.send({ kind: 'cancel', key: 'oom-cancel', epoch: 1 })
      const frame = await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'oom-cancel',
        { timeoutMs: 20_000 },
      )
      const value = execValue(frame)
      expect(value.outcome).toBe(EExecOutcome.OomKilled)
      expect(value.memory).toEqual(expectedMemory())
    } finally {
      await handle.stop()
    }
  }, 30_000)

  it("an OOM kill of a grandchild inside the box counts as the command's OOM", async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      const command = `export BOX=$ATLAS_WORKLOAD_CGROUP/w-$$; sh -c 'echo oom_kill 7 > "$BOX/memory.events"; kill -9 $$'`
      session.send({
        kind: 'run',
        key: 'oom-grandchild',
        epoch: 1,
        op: { op: 'exec', argv: ['/bin/bash', '-c', command] },
      })
      const frame = await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'oom-grandchild',
        { timeoutMs: 20_000 },
      )
      const value = execValue(frame)
      expect(value.outcome).toBe(EExecOutcome.OomKilled)
      expect(value.memory).toEqual(expectedMemory())
    } finally {
      await handle.stop()
    }
  }, 30_000)
})
