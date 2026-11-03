import { EServiceRunStatus, type ServiceInfo } from '@dltech/atlas-protocol'

import { ManagedProcess, type ManagedExit } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'
import { appendLog, closeLog, openLog } from './log-file'

export type RunningService = {
  info: ServiceInfo
  child: ManagedProcess
}

export type EndedService = {
  info: ServiceInfo
}

export const isRunning = (record: RunningService | EndedService): record is RunningService =>
  'child' in record

export type ServicesTable = {
  records: Map<string, RunningService | EndedService>
  deps: DaemonOpsDeps
  onExit(args: { info: ServiceInfo }): void
}

export const spawnService = (args: {
  table: ServicesTable
  op: {
    serviceId: string
    command: string
    cwd: string
    env?: Record<string, string> | undefined
    port?: number | undefined
  }
}): RunningService => {
  const fd = openLog({ home: args.table.deps.home, serviceId: args.op.serviceId })
  const log = { totalBytes: 0 }
  const append = (bytes: Uint8Array): void => {
    log.totalBytes = appendLog({ fd, logTotalBytes: log.totalBytes, bytes })
  }
  let child: ManagedProcess
  try {
    child = ManagedProcess.spawn({
      cmd: ['/bin/sh', '-c', args.op.command],
      cwd: args.op.cwd,
      env: { ...args.table.deps.env, ...args.op.env },
      onStdout: append,
      onStderr: append,
    })
  } catch (error) {
    closeLog({ fd })
    throw error
  }
  const record: RunningService = {
    info: {
      serviceId: args.op.serviceId,
      command: args.op.command,
      pid: child.pid,
      port: args.op.port ?? null,
      status: EServiceRunStatus.Starting,
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
    },
    child,
  }
  void child.exit().then((exit) => settleExit({ table: args.table, record, fd, exit }))
  return record
}

const settleExit = (args: {
  table: ServicesTable
  record: RunningService
  fd: number
  exit: ManagedExit
}): void => {
  const current = args.table.records.get(args.record.info.serviceId)
  if (current !== args.record) return
  const info = args.record.info
  if (info.status === EServiceRunStatus.Starting || info.status === EServiceRunStatus.Ready) {
    info.status = args.exit.oom ? EServiceRunStatus.OomKilled : EServiceRunStatus.Exited
  }
  info.exitCode = args.exit.exitCode
  info.signal = args.exit.signal
  info.endedAt = Date.now()
  closeLog({ fd: args.fd })
  args.table.records.set(info.serviceId, { info })
  args.table.onExit({ info })
}
