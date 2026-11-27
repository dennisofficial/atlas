import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

import { realDaemonTarget } from '../testing'

const target = realDaemonTarget({
  name: 'service-ready',
  entry: join(import.meta.dir, '../index.ts'),
})

describe('a service that dies before its port is ready', () => {
  it('fails at once as exited, not after the whole ready budget', async () => {
    const handle = await target.start()
    try {
      const session = await handle.connect()
      session.send({ kind: 'hello', sessionId: 'service-ready', epoch: 1, token: handle.token })
      await session.until((frame) => frame.kind === 'health')
      const started = Date.now()
      session.send({
        kind: 'run',
        key: 'start-dead',
        epoch: 1,
        op: {
          op: 'services.start',
          serviceId: 'svc-dead',
          command: 'exit 1',
          cwd: '/tmp',
          port: 47_399,
          readyTimeoutMs: 20_000,
        },
      })
      const frame = await session.until(
        (candidate) => candidate.kind === 'result' && candidate.key === 'start-dead',
        { timeoutMs: 25_000 },
      )
      expect(Date.now() - started).toBeLessThan(5_000)
      if (frame.kind !== 'result' || frame.result.status !== 'failed') {
        throw new Error(`unexpected ${JSON.stringify(frame)}`)
      }
      expect(frame.result.error.message).toBe(
        'service svc-dead exited before port 47399 became ready',
      )
    } finally {
      await handle.stop()
    }
  }, 40_000)
})
