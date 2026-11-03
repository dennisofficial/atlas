import {
  CallFailureError,
  ECallFailure,
  EServiceRunStatus,
  type ServiceInfo,
  type ServicesStartOp,
} from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, type GroupContext, defineOp } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from '../deps'
import { readLog } from './log-file'
import { waitForPort } from './port-probe'
import { type EndedService, type RunningService, isRunning, spawnService } from './records'

const READY_TIMEOUT_DEFAULT_MS = 60_000
const SHORT_EXIT_GRACE_MS = 200
const PORT_ENV = 'PORT'

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const servicesGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  (groupCtx: GroupContext) => {
    const records = new Map<string, RunningService | EndedService>()
    const table = {
      records,
      deps,
      onExit: ({ info }: { info: ServiceInfo }): void =>
        groupCtx.publish({ type: 'services.ended', serviceId: info.serviceId, info }),
    }

    const runningRecord = (serviceId: string): RunningService => {
      const record = records.get(serviceId)
      if (record === undefined) {
        throw new CallFailureError({
          code: ECallFailure.NotFound,
          message: `no such service: ${serviceId}`,
        })
      }
      if (!isRunning(record)) {
        throw new CallFailureError({
          code: ECallFailure.InvalidInput,
          message: `service is not running: ${serviceId}`,
        })
      }
      return record
    }

    const start = async (op: ServicesStartOp): Promise<ServiceInfo> => {
      const existing = records.get(op.serviceId)
      if (existing !== undefined && isRunning(existing)) {
        throw new CallFailureError({
          code: ECallFailure.AlreadyExists,
          message: `service already running: ${op.serviceId}`,
        })
      }
      const env =
        op.port === undefined
          ? op.env
          : { ...op.env, [PORT_ENV]: op.env?.[PORT_ENV] ?? String(op.port) }
      let record: RunningService
      try {
        record = spawnService({
          table,
          op: { serviceId: op.serviceId, command: op.command, cwd: op.cwd, env, port: op.port },
        })
      } catch (error) {
        if (error instanceof CallFailureError) throw error
        throw new CallFailureError({
          code: ECallFailure.SpawnFailed,
          message: messageOf(error),
        })
      }
      records.set(op.serviceId, record)
      const port = op.port
      if (port === undefined) {
        if (!isRunning(record)) return { ...record.info }
        try {
          await Promise.race([record.child.exit(), sleepMs(SHORT_EXIT_GRACE_MS)])
        } catch {
          // the exit promise settles the record; a race loss just means still running
        }
        return { ...record.info }
      }
      if (port !== undefined) {
        const timeoutMs = op.readyTimeoutMs ?? READY_TIMEOUT_DEFAULT_MS
        const ready = await waitForPort({
          port,
          timeoutMs,
          cancelled: () => !isRunning(record),
        })
        if (!ready) {
          if (!isRunning(record)) {
            throw new CallFailureError({
              code: ECallFailure.Internal,
              message: `service ${op.serviceId} exited before port ${port} became ready`,
            })
          }
          record.child.kill()
          try {
            await record.child.exit()
          } catch {
            // the exit path is already settling the record; nothing to do
          }
          throw new CallFailureError({
            code: ECallFailure.Internal,
            message: `service ${op.serviceId} not ready within ${timeoutMs} ms`,
          })
        }
        record.info.status = EServiceRunStatus.Ready
        groupCtx.publish({ type: 'services.ready', serviceId: op.serviceId })
      }
      return { ...record.info }
    }

    const stop = async (serviceId: string): Promise<ServiceInfo> => {
      const record = runningRecord(serviceId)
      record.child.kill()
      record.info.status = EServiceRunStatus.Stopped
      try {
        await record.child.exit()
      } catch {
        // exit() already raced its pumps; the record settles from its promise
      }
      const settled = records.get(serviceId)
      return { ...(settled?.info ?? record.info) }
    }

    const list = (): ServiceInfo[] => [...records.values()].map((record) => ({ ...record.info }))

    return {
      name: 'services',
      ops: [
        defineOp({ op: 'services.start', run: ({ op }) => start(op) }),
        defineOp({ op: 'services.stop', run: ({ op }) => stop(op.serviceId) }),
        defineOp({ op: 'services.list', run: () => Promise.resolve(list()) }),
        defineOp({
          op: 'services.log',
          run: ({ op }) => {
            if (!records.has(op.serviceId)) {
              throw new CallFailureError({
                code: ECallFailure.NotFound,
                message: `no such service: ${op.serviceId}`,
              })
            }
            return Promise.resolve(
              readLog({
                home: deps.home,
                serviceId: op.serviceId,
                offset: op.offset,
                limit: op.limit,
              }),
            )
          },
        }),
      ],
      stop: async () => {
        for (const record of records.values()) {
          if (isRunning(record)) record.child.kill()
        }
        await Promise.all(
          [...records.values()].filter(isRunning).map(async (record) => {
            try {
              await record.child.exit()
            } catch {
              // best-effort shutdown; the daemon is going away
            }
          }),
        )
      },
    }
  }
