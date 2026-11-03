import { describe, expect, it } from 'bun:test'

import { ECallFailure, EServiceRunStatus } from '../../ops'
import {
  EPOCH,
  connectAt,
  failureOf,
  okValue,
  runToEnd,
  sleep,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'
import {
  eventFrame,
  freePort,
  httpListener,
  startAndReady,
  startOp,
  untilEvent,
} from './services-support'

export const describeServicesConformance = (target: DaemonConformanceTarget): void => {
  describe(`services conformance (${target.name})`, () => {
    it('starts a service with a port, reports ready, and lists it', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const { session, info } = await startAndReady({ handle, serviceId: 'svc-a' })
          expect(info.serviceId).toBe('svc-a')
          expect(info.pid).toBeGreaterThan(0)
          const listed = await runToEnd({ session, key: 's-list', op: { op: 'services.list' } })
          const services = okValue({ result: listed, op: 'services.list' })
          const found = services.find((s) => s.serviceId === 'svc-a')
          expect(found?.status).toBe(EServiceRunStatus.Ready)
        },
      }))

    it('stops a running service and reports it stopped', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const { session } = await startAndReady({ handle, serviceId: 'svc-b' })
          const stopped = await runToEnd({
            session,
            key: 's-stop',
            op: { op: 'services.stop', serviceId: 'svc-b' },
            timeoutMs: 10_000,
          })
          const info = okValue({ result: stopped, op: 'services.stop' })
          expect(info.status).toBe(EServiceRunStatus.Stopped)
          expect(info.endedAt).toBeDefined()
          await untilEvent({ session, type: 'services.ended', serviceId: 'svc-b' })
        },
      }))

    it('stop kills the service process and its children (real processes)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const port = await freePort()
        const session = await connectAt({ handle })
        const command = `${httpListener(port)} & sleep 300 & wait`
        const started = await runToEnd({
          session,
          key: 's-tree-start',
          op: startOp({ serviceId: 'svc-tree', command, cwd: '/', port }),
          timeoutMs: 15_000,
        })
        const info = okValue({ result: started, op: 'services.start' })
        expect(handle.processAlive(info.pid)).toBe(true)
        const stopped = await runToEnd({
          session,
          key: 's-tree-stop',
          op: { op: 'services.stop', serviceId: 'svc-tree' },
          timeoutMs: 10_000,
        })
        expect(okValue({ result: stopped, op: 'services.stop' }).status).toBe(
          EServiceRunStatus.Stopped,
        )
        await sleep(300)
        expect(handle.processAlive(info.pid)).toBe(false)
      } finally {
        await handle.stop()
      }
    }, 20_000)

    it('emits ended with the exit code when a service exits on its own', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const started = await runToEnd({
            session,
            key: 's-exit-start',
            op: startOp({ serviceId: 'svc-c', command: 'echo hi; exit 7', cwd: '/' }),
            timeoutMs: 10_000,
          })
          const info = okValue({ result: started, op: 'services.start' })
          expect(info.status).toBe(EServiceRunStatus.Exited)
          expect(info.exitCode).toBe(7)
          await untilEvent({ session, type: 'services.ended', serviceId: 'svc-c' })
          const ended = session.frames().find((f) => eventFrame(f, 'services.ended', 'svc-c'))
          expect(ended).toBeDefined()
        },
      }))

    it('fails Internal and leaves nothing running when readiness times out', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const port = handle.realProcesses ? await freePort() : 9998
          const result = await runToEnd({
            session,
            key: 's-timeout-start',
            op: startOp({
              serviceId: 'svc-d',
              command: 'sleep 60',
              cwd: '/',
              port,
              readyTimeoutMs: 400,
            }),
            timeoutMs: 10_000,
          })
          expect(failureOf(result)).toBe(ECallFailure.Internal)
          await sleep(200)
          const listed = await runToEnd({ session, key: 's-list-d', op: { op: 'services.list' } })
          const services = okValue({ result: listed, op: 'services.list' })
          const found = services.find((s) => s.serviceId === 'svc-d')
          if (found !== undefined) {
            expect([EServiceRunStatus.Exited, EServiceRunStatus.Stopped]).toContain(found.status)
          }
        },
      }))

    it('reads the log at offsets', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const { session } = await startAndReady({ handle, serviceId: 'svc-log' })
          await sleep(handle.realProcesses ? 300 : 50)
          const first = await runToEnd({
            session,
            key: 's-log-1',
            op: { op: 'services.log', serviceId: 'svc-log', offset: 0, limit: 4 },
          })
          const page1 = okValue({ result: first, op: 'services.log' })
          expect(page1.offset).toBe(0)
          expect(page1.totalBytes).toBeGreaterThan(0)
          const bytes1 = Buffer.from(page1.bytes, 'base64')
          expect(bytes1.length).toBeLessThanOrEqual(4)
          const second = await runToEnd({
            session,
            key: 's-log-2',
            op: { op: 'services.log', serviceId: 'svc-log', offset: bytes1.length, limit: 1000 },
          })
          const page2 = okValue({ result: second, op: 'services.log' })
          expect(page2.totalBytes).toBe(page1.totalBytes)
          const whole = Buffer.concat([bytes1, Buffer.from(page2.bytes, 'base64')]).toString('utf8')
          expect(whole.length).toBe(page1.totalBytes)
        },
      }))

    it('rejects a duplicate running id with already-exists', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const { session } = await startAndReady({ handle, serviceId: 'svc-dup' })
          const again = await runToEnd({
            session,
            key: 's-dup-start',
            op: startOp({
              serviceId: 'svc-dup',
              command: handle.realProcesses ? httpListener(await freePort()) : 'listen 1',
              cwd: '/',
              port: handle.realProcesses ? await freePort() : 9997,
            }),
            timeoutMs: 10_000,
          })
          expect(failureOf(again)).toBe(ECallFailure.AlreadyExists)
        },
      }))

    it('restarts an ended service under the same id and replaces the log', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const first = await runToEnd({
            session,
            key: 's-re-1',
            op: startOp({ serviceId: 'svc-re', command: 'echo first; exit 0', cwd: '/' }),
            timeoutMs: 10_000,
          })
          expect(okValue({ result: first, op: 'services.start' }).exitCode).toBe(0)
          const second = await runToEnd({
            session,
            key: 's-re-2',
            op: startOp({ serviceId: 'svc-re', command: 'echo second; exit 0', cwd: '/' }),
            timeoutMs: 10_000,
          })
          expect(okValue({ result: second, op: 'services.start' }).exitCode).toBe(0)
          await sleep(handle.realProcesses ? 300 : 50)
          const log = await runToEnd({
            session,
            key: 's-re-log',
            op: { op: 'services.log', serviceId: 'svc-re', offset: 0, limit: 1000 },
          })
          const text = Buffer.from(
            okValue({ result: log, op: 'services.log' }).bytes,
            'base64',
          ).toString('utf8')
          expect(text).toContain('second')
        },
      }))

    it('survives a takeover and still answers list and stop', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const { session: older } = await startAndReady({ handle, serviceId: 'svc-take' })
          const newer = await connectAt({ handle, epoch: EPOCH + 1 })
          const listed = await runToEnd({
            session: newer,
            key: 's-take-list',
            op: { op: 'services.list' },
            epoch: EPOCH + 1,
          })
          const services = okValue({ result: listed, op: 'services.list' })
          const found = services.find((s) => s.serviceId === 'svc-take')
          expect(found?.status).toBe(EServiceRunStatus.Ready)
          const stopped = await runToEnd({
            session: newer,
            key: 's-take-stop',
            op: { op: 'services.stop', serviceId: 'svc-take' },
            epoch: EPOCH + 1,
            timeoutMs: 10_000,
          })
          expect(okValue({ result: stopped, op: 'services.stop' }).status).toBe(
            EServiceRunStatus.Stopped,
          )
          expect(older.frames().some((f) => eventFrame(f, 'services.ended', 'svc-take'))).toBe(
            false,
          )
        },
      }))

    it('start without a port returns starting or ready without probing', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const result = await runToEnd({
            session,
            key: 's-noport',
            op: startOp({ serviceId: 'svc-noport', command: 'sleep 30', cwd: '/' }),
            timeoutMs: 10_000,
          })
          const info = okValue({ result, op: 'services.start' })
          expect(info.status).toBe(EServiceRunStatus.Starting)
          expect(info.port).toBeNull()
        },
      }))
  })
}
