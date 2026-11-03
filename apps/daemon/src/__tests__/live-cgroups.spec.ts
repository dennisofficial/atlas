import { describe, expect, it } from 'bun:test'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EExecOutcome, EProtection } from '@dltech/atlas-protocol'

import { realDaemonTarget } from '../testing'

const live = process.env.ATLAS_LIVE_SANDBOX === '1'

describe.skipIf(!live)('daemon on a real cgroup v2 sandbox', () => {
  const target = realDaemonTarget({
    name: 'live',
    entry: join(import.meta.dir, '../index.ts'),
    realCgroups: true,
  })

  it('reports applied protection, boxes each call, and reports an OOM kill', async () => {
    const handle = await target.start()
    try {
      const session = await handle.connect()
      session.send({ kind: 'hello', sessionId: 's', epoch: 1, token: handle.token })
      const health = await session.until((frame) => frame.kind === 'health')
      if (health.kind !== 'health') throw new Error('no health')
      expect(health.protection.cgroups.status).toBe(EProtection.Applied)
      expect(health.protection.oomScoreAdj.status).toBe(EProtection.Applied)

      session.send({
        kind: 'run',
        key: 'live-box',
        epoch: 1,
        op: { op: 'exec', argv: ['/bin/sh', '-c', 'cat /proc/self/cgroup'] },
      })
      await session.until((frame) => frame.kind === 'result' && frame.key === 'live-box')
      const box = session
        .frames()
        .filter((frame) => frame.kind === 'output' && frame.key === 'live-box')
        .map((frame) =>
          frame.kind === 'output' ? Buffer.from(frame.bytes, 'base64').toString() : '',
        )
        .join('')
      expect(box).toMatch(/atlas-work\/w-\d+/)
      expect(readFileSync('/proc/self/oom_score_adj', 'utf8').trim()).not.toBe('-900')

      session.send({
        kind: 'run',
        key: 'live-oom',
        epoch: 1,
        op: {
          op: 'exec',
          argv: [
            '/bin/sh',
            '-c',
            'echo 64M > /sys/fs/cgroup/atlas-work/w-$$/memory.max; head -c 512M /dev/zero | tail',
          ],
        },
      })
      const oom = await session.until(
        (frame) => frame.kind === 'result' && frame.key === 'live-oom',
        {
          timeoutMs: 60_000,
        },
      )
      if (oom.kind !== 'result' || oom.result.status !== 'ok' || oom.result.op !== 'exec') {
        throw new Error(`unexpected ${JSON.stringify(oom)}`)
      }
      expect(oom.result.value.outcome).toBe(EExecOutcome.OomKilled)
      expect(
        session
          .frames()
          .some((frame) => frame.kind === 'event' && frame.event.type === 'exec.oom-kill'),
      ).toBe(true)
    } finally {
      await handle.stop()
    }
  }, 90_000)
})
