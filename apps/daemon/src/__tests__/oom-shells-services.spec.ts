import { describe, expect, it } from 'bun:test'

import {
  type DaemonFrame,
  EServiceRunStatus,
  EShellRunStatus,
  type ServiceInfo,
} from '@dltech/atlas-protocol'

import { expectedMemory, oomTarget, openSession, writeOomEvents } from './oom-rig'

const serviceValue = (frame: DaemonFrame): ServiceInfo => {
  if (
    frame.kind !== 'result' ||
    frame.result.status !== 'ok' ||
    frame.result.op !== 'services.stop'
  ) {
    throw new Error(`unexpected ${JSON.stringify(frame)}`)
  }
  return frame.result.value
}

describe('a shell and a service that the kernel kills for memory', () => {
  it('a shell that times out over an out-of-memory box ends as out of memory', async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      session.send({
        kind: 'run',
        key: 'shell-oom',
        epoch: 1,
        op: {
          op: 'shells.launch',
          shellId: 'oom-shell',
          command: `${writeOomEvents(4)}; sleep 5`,
          cwd: '/tmp',
          timeoutMs: 300,
        },
      })
      await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'shell-oom',
      )
      const ended = await session.until(
        (candidate) =>
          candidate.kind === 'event' &&
          candidate.event.type === 'shells.ended' &&
          candidate.event.shellId === 'oom-shell',
        { timeoutMs: 20_000 },
      )
      if (ended.kind !== 'event' || ended.event.type !== 'shells.ended') {
        throw new Error(`unexpected ${JSON.stringify(ended)}`)
      }
      expect(ended.event.info.status).toBe(EShellRunStatus.OomKilled)
      expect(ended.event.info.memory).toEqual(expectedMemory())
    } finally {
      await handle.stop()
    }
  }, 30_000)

  it('a stopped service whose box was out of memory ends as out of memory', async () => {
    const handle = await oomTarget.start()
    try {
      const session = await openSession(handle)
      session.send({
        kind: 'run',
        key: 'service-start',
        epoch: 1,
        op: {
          op: 'services.start',
          serviceId: 'oom-service',
          command: `${writeOomEvents(2)}; sleep 5`,
          cwd: '/tmp',
        },
      })
      await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'service-start',
      )
      session.send({
        kind: 'run',
        key: 'service-stop',
        epoch: 1,
        op: { op: 'services.stop', serviceId: 'oom-service' },
      })
      const stopped = await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'service-stop',
        { timeoutMs: 20_000 },
      )
      const info = serviceValue(stopped)
      expect(info.status).toBe(EServiceRunStatus.OomKilled)
      expect(info.memory).toEqual(expectedMemory())
    } finally {
      await handle.stop()
    }
  }, 30_000)
})
