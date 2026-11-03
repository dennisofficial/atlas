import {
  defineOp,
  type CallContext,
  type DaemonGroupFactory,
  type GroupContext,
} from '../../engine'
import {
  CallFailureError,
  ECallFailure,
  EServiceRunStatus,
  type ServiceInfo,
  type ServicesLogResult,
  type ServicesStartOp,
} from '../../ops'
import type { MemoryFileSystem } from '../memory-files'

const LOG_CAP_BYTES = 32 * 1024 * 1024

type FakeService = {
  info: ServiceInfo
  log: Uint8Array[]
  logBytes: number
  timers: Set<ReturnType<typeof setTimeout>>
}

const unquote = (text: string): string => text.trim().replace(/^['"]|['"]$/g, '')

const parseEchoLines = (command: string): readonly string[] => {
  const matches = [...command.matchAll(/echo\s+([^;]+)/g)]
  return matches.map((match) => `${unquote(match[1] ?? '')}\n`)
}

const sleepMsOf = (command: string): number | undefined => {
  const match = /sleep\s+([\d.]+)/.exec(command)
  return match?.[1] === undefined ? undefined : Math.ceil(Number(match[1]) * 1000)
}

const exitCodeOf = (command: string): number => {
  const match = /exit\s+(\d+)/.exec(command)
  return match?.[1] === undefined ? 0 : Number(match[1])
}

const runsForever = (command: string): boolean =>
  command.includes('while true') || command.includes('listen')

const appendToLog = (args: { service: FakeService; text: string }): void => {
  const bytes = new TextEncoder().encode(args.text)
  if (args.service.logBytes + bytes.length > LOG_CAP_BYTES) return
  args.service.log.push(bytes)
  args.service.logBytes += bytes.length
}

const logResult = (args: {
  service: FakeService
  offset: number
  limit: number
}): ServicesLogResult => {
  const totalBytes = args.service.logBytes
  if (args.offset >= totalBytes) return { offset: totalBytes, bytes: '', totalBytes }
  const whole = Buffer.concat(args.service.log)
  const slice = whole.subarray(args.offset, Math.min(args.offset + args.limit, totalBytes))
  return { offset: args.offset, bytes: slice.toString('base64'), totalBytes }
}

const isRunning = (service: FakeService): boolean =>
  service.info.status === EServiceRunStatus.Starting ||
  service.info.status === EServiceRunStatus.Ready

export const fakeServicesGroup =
  (args: { fs: MemoryFileSystem }): DaemonGroupFactory =>
  (groupCtx: GroupContext) => {
    const services = new Map<string, FakeService>()
    let nextPid = 4000

    const finishService = (args2: { service: FakeService; status: EServiceRunStatus }): void => {
      const { info } = args2.service
      info.status = args2.status
      info.endedAt = Date.now()
      for (const timer of args2.service.timers) clearTimeout(timer)
      args2.service.timers.clear()
      groupCtx.publish({
        type: 'services.ended',
        serviceId: info.serviceId,
        info: { ...info },
      })
    }

    const end = (args2: { service: FakeService; code: number }): void => {
      if (!isRunning(args2.service)) return
      args2.service.info.exitCode = args2.code
      finishService({ service: args2.service, status: EServiceRunStatus.Exited })
    }

    const track = (args2: { service: FakeService; ms: number; run: () => void }): void => {
      const timer = setTimeout(() => {
        args2.service.timers.delete(timer)
        args2.run()
      }, args2.ms)
      args2.service.timers.add(timer)
    }

    const start = async (op: ServicesStartOp, ctx: CallContext): Promise<ServiceInfo> => {
      const existing = services.get(op.serviceId)
      if (existing !== undefined && isRunning(existing)) {
        throw new CallFailureError({
          code: ECallFailure.AlreadyExists,
          message: `service already running: ${op.serviceId}`,
        })
      }
      if (!args.fs.exists({ path: op.cwd })) {
        throw new CallFailureError({
          code: ECallFailure.SpawnFailed,
          message: `ENOENT: no such file or directory, chdir '${op.cwd}'`,
        })
      }
      nextPid += 1
      const service: FakeService = {
        info: {
          serviceId: op.serviceId,
          command: op.command,
          pid: nextPid,
          port: op.port ?? null,
          status: EServiceRunStatus.Starting,
          exitCode: null,
          signal: null,
          startedAt: Date.now(),
        },
        log: [],
        logBytes: 0,
        timers: new Set(),
      }
      services.set(op.serviceId, service)
      for (const line of parseEchoLines(op.command)) {
        appendToLog({ service, text: line })
      }
      const sleepMs = sleepMsOf(op.command)
      if (sleepMs !== undefined) {
        track({ service, ms: sleepMs, run: () => end({ service, code: exitCodeOf(op.command) }) })
      } else if (!runsForever(op.command)) {
        end({ service, code: exitCodeOf(op.command) })
      }
      if (op.port !== undefined && isRunning(service)) {
        if (runsForever(op.command) || op.command.includes('bun -e')) {
          service.info.status = EServiceRunStatus.Ready
          groupCtx.publish({ type: 'services.ready', serviceId: op.serviceId })
        } else {
          service.info.signal = 'SIGKILL'
          finishService({ service, status: EServiceRunStatus.Stopped })
          throw new CallFailureError({
            code: ECallFailure.Internal,
            message: `service ${op.serviceId} not ready within ${op.readyTimeoutMs ?? 60_000} ms`,
          })
        }
      }
      if (ctx.signal.aborted && isRunning(service)) {
        end({ service, code: 143 })
      }
      return { ...service.info }
    }

    const stop = async (serviceId: string): Promise<ServiceInfo> => {
      const service = services.get(serviceId)
      if (service === undefined) {
        throw new CallFailureError({
          code: ECallFailure.NotFound,
          message: `no such service: ${serviceId}`,
        })
      }
      if (!isRunning(service)) {
        throw new CallFailureError({
          code: ECallFailure.InvalidInput,
          message: `service is not running: ${serviceId}`,
        })
      }
      service.info.signal = 'SIGTERM'
      finishService({ service, status: EServiceRunStatus.Stopped })
      return { ...service.info }
    }

    return {
      name: 'services',
      ops: [
        defineOp({ op: 'services.start', run: ({ op, ctx }) => start(op, ctx) }),
        defineOp({ op: 'services.stop', run: ({ op }) => stop(op.serviceId) }),
        defineOp({
          op: 'services.list',
          run: () => Promise.resolve([...services.values()].map((s) => ({ ...s.info }))),
        }),
        defineOp({
          op: 'services.log',
          run: ({ op }) => {
            const service = services.get(op.serviceId)
            if (service === undefined) {
              throw new CallFailureError({
                code: ECallFailure.NotFound,
                message: `no such service: ${op.serviceId}`,
              })
            }
            return Promise.resolve(logResult({ service, offset: op.offset, limit: op.limit }))
          },
        }),
      ],
      stop: async () => {
        for (const service of services.values()) {
          if (isRunning(service)) {
            service.info.signal = 'SIGKILL'
            finishService({ service, status: EServiceRunStatus.Exited })
          }
        }
      },
    }
  }
